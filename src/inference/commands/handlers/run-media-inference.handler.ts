import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { CLIENT_PROTOCOL_KINDS, type ModelKind, type ParameterPolicy } from "@/db/schemas/index.js";
import {
  isUpstreamModelUsable,
  type SnapshotRoute,
  type SnapshotUpstreamModel,
} from "@/snapshot/models/snapshot.js";
import { SnapshotService } from "@/snapshot/providers/snapshot.service.js";
import type { ProviderAccountCredential } from "@/upstream/models/provider-account-credential.js";
import type { UsageJob } from "@/usage/models/usage-job.js";
import { UsageProducer } from "@/usage/jobs/usage.producer.js";
import {
  assertKindServedHere,
  type Destination,
  probeDestination,
  upstreamModelServedHere,
  usableModel,
} from "../../models/destination.js";
import { GatewayError } from "../../models/gateway-error.js";
import type { InferenceCaller } from "../../models/inference.js";
import type { MediaClientContract, MediaReply, MediaRequest } from "../../models/media-kind.js";
import { withMediaPlaceholders } from "../../models/media-placeholders.js";
import { effectiveParameterPolicy, isWatermarkedUnder } from "../../models/parameter-policy.js";
import { failedRequestUsage, requestOwnerOf } from "../../models/request-usage.js";
import { type AttemptTarget, endpointOf, routePath } from "../../models/route-selection.js";
import { UsageMeter } from "../../models/usage-meter.js";
import { upstreamAuthHeaders } from "../../protocols/converters.js";
import { AttemptRunner } from "../../providers/attempt-runner.js";
import { CallerLimits } from "../../providers/caller-limits.js";
import { MediaUpstreamClient } from "../../providers/media-upstream-client.js";
import { DEFAULT_TIMEOUTS, totalTimeoutMsOf } from "../../providers/upstream-client.js";
import { RunMediaInferenceCommand } from "../impl/run-media-inference.command.js";

const HTTP_OK = 200;

/**
 * The inference path of every media Kind: parse with the Kind's client
 * contract, resolve the Model (or the Upstream Model of a direct test), keep
 * the Routes the request's limits allow, then make Attempts with Fallback
 * until one answers, and write the result back. The Kind's upstream Protocol
 * makes each Attempt, fetching the files it generated (ADR 0028).
 */
@CommandHandler(RunMediaInferenceCommand)
export class RunMediaInferenceHandler implements ICommandHandler<RunMediaInferenceCommand> {
  constructor(
    private readonly snapshot: SnapshotService,
    private readonly attempts: AttemptRunner,
    private readonly upstream: MediaUpstreamClient,
    private readonly usage: UsageProducer,
    private readonly callerLimits: CallerLimits,
  ) {}

  async execute(command: RunMediaInferenceCommand): Promise<MediaReply> {
    const { contract, body, caller, connection, onUsage } = command;
    const meter = new UsageMeter(
      requestOwnerOf(caller),
      contract.protocol,
      connection.requestBytes,
      connection.sender,
    );
    meter.requestReceived(connection.requestHeaders, withMediaPlaceholders(body));
    const record = (job: UsageJob): void => {
      this.usage.enqueue(job);
      onUsage(job);
    };
    try {
      const reply = await this.serve(command, meter);
      record(meter.finish(HTTP_OK, false));
      return reply;
    } catch (error) {
      record(failedRequestUsage(meter, (failure) => contract.writeError(failure), error));
      throw error;
    }
  }

  private async serve(command: RunMediaInferenceCommand, meter: UsageMeter): Promise<MediaReply> {
    const { contract, body, caller, connection } = command;
    await this.callerLimits.assertWithinLimits(caller);
    const request = contract.parseRequest(body);
    meter.requestParsed(false);
    const destination = this.resolve(command, request, meter);
    const createdAt = new Date();
    const { result, servedBy } = await this.attempts.answer(
      destination,
      meter,
      (attemptTarget) => ({
        sentServiceTier: null,
        send: async (credential) => {
          const outcome = await this.upstream.generate({
            ...this.upstreamCallFor(contract, destination, attemptTarget, credential),
            request: policedRequest(contract, request, destination, attemptTarget.route),
            clientSignal: connection.signal,
          });
          meter.attemptAnswered(outcome.upstreamRequestId);
          meter.unitsCounted(outcome.units);
          meter.attemptSucceeded();
          return {
            result: outcome.result,
            servedBy: {
              providerAccountId: attemptTarget.providerAccount.id,
              upstreamModelRowId: attemptTarget.upstreamModel.id,
            },
          };
        },
      }),
    );
    const reply = contract.writeResponse(result, {
      modelName: destination.name,
      createdAt,
      caller,
      servedBy,
    });
    meter.responseWritten(reply.body.byteLength);
    return reply;
  }

  private resolve(
    { contract, caller, target }: RunMediaInferenceCommand,
    request: MediaRequest,
    meter: UsageMeter,
  ): Destination {
    const kind = CLIENT_PROTOCOL_KINDS[contract.protocol];
    switch (target.kind) {
      case "named-model":
        return this.resolveNamedModel(contract, request, caller, kind, meter);
      case "upstream-model":
        return this.resolveUpstreamModel(contract, request, target.upstreamModelId, kind);
      case "probe":
        return probeDestination(this.snapshot.current, target, kind);
    }
  }

  /** The Model the request names, with the Routes that can serve it. */
  private resolveNamedModel(
    contract: MediaClientContract<MediaRequest, unknown>,
    request: MediaRequest,
    caller: InferenceCaller,
    kind: ModelKind,
    meter: UsageMeter,
  ): Destination {
    const model = usableModel(this.snapshot.current, request.model, caller);
    meter.modelResolved(model.id, model.name);
    assertKindServedHere(`Model "${model.name}"`, model.kind, kind);
    const enabledRoutes = model.routes.filter((route) => route.isEnabled);
    const servingRoutes = enabledRoutes.filter(
      (route) => unservableReasonOf(contract, route.upstreamModel, request) === null,
    );
    if (servingRoutes.length === 0) {
      throw new GatewayError(
        "no_capable_route",
        `No Route of the Model "${model.name}" can serve ${firstReasonOf(contract, enabledRoutes, request)}`,
        "client",
      );
    }
    return {
      kind: "fallback",
      model,
      id: model.id,
      name: model.name,
      paths: servingRoutes.map(routePath),
    };
  }

  /** The Upstream Model of a direct Upstream Model test, if it can serve the request. */
  private resolveUpstreamModel(
    contract: MediaClientContract<MediaRequest, unknown>,
    request: MediaRequest,
    upstreamModelRowId: string,
    kind: ModelKind,
  ): Destination {
    const upstreamModel = upstreamModelServedHere(this.snapshot.current, upstreamModelRowId, kind);
    const reason = unservableReasonOf(contract, upstreamModel, request);
    if (reason !== null) {
      throw new GatewayError(
        "no_capable_route",
        `The Upstream Model "${upstreamModel.upstreamModelId}" can't serve ${reason}`,
        "client",
      );
    }
    return {
      kind: "fallback",
      model: null,
      id: upstreamModel.id,
      name: upstreamModel.upstreamModelId,
      paths: [{ route: null, upstreamModel }],
    };
  }

  private upstreamCallFor(
    contract: MediaClientContract<MediaRequest, unknown>,
    destination: Destination,
    { route, upstreamModel }: AttemptTarget,
    credential: ProviderAccountCredential,
  ) {
    const { provider } = upstreamModel;
    const endpoint = endpointOf(upstreamModel);
    const protocol = endpoint && contract.upstreamProtocols[endpoint.protocol];
    if (!endpoint || !protocol) {
      // unservableReasonOf() already skips these Upstream Models.
      throw new Error(
        `The Provider ${provider.slug} has no ${upstreamModel.kind} endpoint the gateway can call`,
      );
    }
    return {
      protocol,
      target: {
        baseUrl: endpoint.baseUrl,
        upstreamModelId: upstreamModel.upstreamModelId,
        isWatermarked: isWatermarkedOn(destination, route),
      },
      authHeaders: {
        ...credential.identityHeaders,
        ...upstreamAuthHeaders(provider.authStyle, credential.secret),
      },
      timeouts: {
        ...DEFAULT_TIMEOUTS,
        totalMs: totalTimeoutMsOf(destination, route),
      },
    };
  }
}

/**
 * The Parameter Policy one Attempt goes under: the Model's, with the Route's
 * override. Null for a direct Upstream Model test, which has no Model.
 */
function attemptPolicyOf(
  destination: Destination,
  route: SnapshotRoute | null,
): ParameterPolicy | null {
  if (!destination.model) {
    return null;
  }
  return effectiveParameterPolicy(
    destination.model.parameterPolicy,
    route?.parameterPolicyOverride ?? null,
  );
}

/** The request one Attempt sends, under its Parameter Policy. */
function policedRequest(
  contract: MediaClientContract<MediaRequest, unknown>,
  request: MediaRequest,
  destination: Destination,
  route: SnapshotRoute | null,
): MediaRequest {
  const policy = attemptPolicyOf(destination, route);
  if (!policy || !contract.applyParameterPolicy) {
    return request;
  }
  return contract.applyParameterPolicy(request, policy);
}

/** Whether the Route's Parameter Policy turns the watermark on; a direct test has no policy. */
function isWatermarkedOn(destination: Destination, route: SnapshotRoute | null): boolean {
  const policy = attemptPolicyOf(destination, route);
  return policy !== null && isWatermarkedUnder(policy);
}

/** The reason no Route could serve the request, from the first Route that gives one. */
function firstReasonOf(
  contract: MediaClientContract<MediaRequest, unknown>,
  routes: SnapshotRoute[],
  request: MediaRequest,
): string {
  for (const route of routes) {
    const reason = unservableReasonOf(contract, route.upstreamModel, request);
    if (reason !== null) {
      return reason;
    }
  }
  return "this request";
}

/**
 * Why the Upstream Model can't serve the request, or null when it can: it
 * must be enabled along with its Provider, have an endpoint in a Protocol of
 * the Kind, and meet the request's limits.
 */
function unservableReasonOf(
  contract: MediaClientContract<MediaRequest, unknown>,
  upstreamModel: SnapshotUpstreamModel,
  request: MediaRequest,
): string | null {
  const endpoint = endpointOf(upstreamModel);
  if (
    !isUpstreamModelUsable(upstreamModel) ||
    endpoint === undefined ||
    contract.upstreamProtocols[endpoint.protocol] === undefined
  ) {
    return "this request";
  }
  return contract.unservableReason(upstreamModel, request);
}
