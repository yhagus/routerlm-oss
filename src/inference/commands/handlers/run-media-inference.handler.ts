import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { CLIENT_PROTOCOL_KINDS, type ModelKind, type ParameterPolicy } from '@/db/schemas';
import {
  isUpstreamModelUsable,
  type SnapshotRoute,
  type SnapshotUpstreamModel,
} from '@/snapshot/models/snapshot';
import { SnapshotService } from '@/snapshot/providers/snapshot.service';
import type { ProviderAccountCredential } from '@/upstream/models/provider-account-credential';
import type { UsageJob } from '@/usage/models/usage-job';
import { UsageProducer } from '@/usage/jobs/usage.producer';
import {
  assertKindServedHere,
  clientModelTargetOf,
  type Destination,
  probeDestination,
  upstreamModelServedHere,
} from '@/inference/models/destination';
import { GatewayError } from '@/inference/models/gateway-error';
import type { InferenceCaller } from '@/inference/models/inference';
import type {
  MediaClientContract,
  MediaReply,
  MediaRequest,
  MediaUpstreamProtocol,
} from '@/inference/models/media-kind';
import { withMediaPlaceholders } from '@/inference/models/media-placeholders';
import { effectiveParameterPolicy, isWatermarkedUnder } from '@/inference/models/parameter-policy';
import { failedRequestUsage, requestOwnerOf } from '@/inference/models/request-usage';
import { type AttemptTarget, endpointOf, routePath } from '@/inference/models/route-selection';
import { UsageMeter } from '@/inference/models/usage-meter';
import { type CallableEndpoint, callableEndpointOf } from '@/inference/models/callable-endpoint';
import { upstreamAuthHeaders } from '@/inference/protocols/converters';
import { AttemptRunner } from '@/inference/providers/attempt-runner';
import { CallerLimits } from '@/inference/providers/caller-limits';
import { MediaUpstreamClient } from '@/inference/providers/media-upstream-client';
import { DEFAULT_TIMEOUTS, totalTimeoutMsOf } from '@/inference/providers/upstream-client';
import { RunMediaInferenceCommand } from '@/inference/commands/impl/run-media-inference.command';

const HTTP_OK = 200;

type MediaEndpoint = CallableEndpoint<MediaUpstreamProtocol<MediaRequest, unknown>>;

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
    const { result, servedBy } = await this.attempts.answer(destination, meter, (attemptTarget) => {
      const endpoint = callableEndpointOf(attemptTarget.upstreamModel, contract.upstreamProtocols);
      return {
        upstreamProtocol: endpoint.protocol,
        sentServiceTier: null,
        send: async (credential) => {
          const outcome = await this.upstream.generate({
            ...this.upstreamCallFor(destination, attemptTarget, endpoint, credential),
            request: policedRequest(contract, request, destination, attemptTarget.route),
            clientSignal: connection.signal,
          });
          meter.attemptAnswered(outcome.upstreamStatus, outcome.upstreamRequestId);
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
      };
    });
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
      case 'named-model':
        return this.resolveNamedModel(contract, request, caller, kind, meter);
      case 'upstream-model':
        return this.resolveUpstreamModel(contract, request, target.upstreamModelId, kind);
      case 'probe':
        return probeDestination(this.snapshot.current, target, kind);
    }
  }

  private resolveNamedModel(
    contract: MediaClientContract<MediaRequest, unknown>,
    request: MediaRequest,
    caller: InferenceCaller,
    kind: ModelKind,
    meter: UsageMeter,
  ): Destination {
    meter.modelRequested(request.model);
    const target = clientModelTargetOf(this.snapshot.current, request.model, caller);
    if (target.kind === 'upstream-model') {
      return this.resolveUpstreamModel(contract, request, target.upstreamModel.id, kind);
    }
    const { model } = target;
    meter.modelResolved(model.id, model.name);
    assertKindServedHere(`Model "${model.name}"`, model.kind, kind);
    const enabledRoutes = model.routes.filter((route) => route.isEnabled);
    const servingRoutes = enabledRoutes.filter(
      (route) => unservableReasonOf(contract, route.upstreamModel, request) === null,
    );
    if (servingRoutes.length === 0) {
      throw new GatewayError(
        'no_capable_route',
        `No Route of the Model "${model.name}" can serve ${firstReasonOf(contract, enabledRoutes, request)}`,
        'client',
      );
    }
    return {
      kind: 'fallback',
      model,
      id: model.id,
      name: model.name,
      paths: servingRoutes.map(routePath),
    };
  }

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
        'no_capable_route',
        `The Upstream Model "${upstreamModel.upstreamModelId}" can't serve ${reason}`,
        'client',
      );
    }
    return {
      kind: 'fallback',
      model: null,
      id: upstreamModel.id,
      name: upstreamModel.upstreamModelId,
      paths: [{ route: null, upstreamModel }],
    };
  }

  private upstreamCallFor(
    destination: Destination,
    { route, upstreamModel }: AttemptTarget,
    endpoint: MediaEndpoint,
    credential: ProviderAccountCredential,
  ) {
    const { provider } = upstreamModel;
    return {
      protocol: endpoint.adapter,
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

function isWatermarkedOn(destination: Destination, route: SnapshotRoute | null): boolean {
  const policy = attemptPolicyOf(destination, route);
  return policy !== null && isWatermarkedUnder(policy);
}

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
  return 'this request';
}

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
    return 'this request';
  }
  return contract.unservableReason(upstreamModel, request);
}
