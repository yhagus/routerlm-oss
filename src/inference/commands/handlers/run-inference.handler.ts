import { randomUUID } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { CLIENT_PROTOCOL_KINDS, type ModelKind } from "@/db/schemas/index.js";
import {
  type SnapshotModel,
  type SnapshotUpstreamModel,
  validQuirksOf,
} from "@/snapshot/models/snapshot.js";
import type { ClientConnection } from "@/libs/models/client-connection.js";
import { SnapshotService } from "@/snapshot/providers/snapshot.service.js";
import type { ProviderAccountCredential } from "@/upstream/models/provider-account-credential.js";
import type { UsageJob } from "@/usage/models/usage-job.js";
import { UsageProducer } from "@/usage/jobs/usage.producer.js";
import {
  AttemptFailedError,
  ClientCancelledError,
  gatewayErrorFor,
} from "../../models/attempt-failure.js";
import {
  DEFAULT_CACHE_MARKER_LIMIT,
  withAutomaticCacheBreakpoints,
} from "../../models/automatic-cache-breakpoints.js";
import {
  assertKindServedHere,
  type Destination,
  probeDestination,
  upstreamModelServedHere,
  usableModel,
} from "../../models/destination.js";
import { GatewayError } from "../../models/gateway-error.js";
import type { InferenceRequest } from "../../models/internal-format.js";
import { applyParameterPolicy, effectiveParameterPolicy } from "../../models/parameter-policy.js";
import { promptCacheKey } from "../../models/prompt-cache-key.js";
import { encodedFor, failedRequestUsage, requestOwnerOf } from "../../models/request-usage.js";
import type {
  ClientProtocolConverter,
  ClientStreamWriter,
  ResponseContext,
} from "../../protocols/client-protocol-converter.js";
import { UPSTREAM_PROTOCOL_CONVERTERS, upstreamAuthHeaders } from "../../protocols/converters.js";
import {
  type AttemptTarget,
  canServe,
  capableRoutes,
  endpointOf,
  routePath,
} from "../../models/route-selection.js";
import { AttemptRunner } from "../../providers/attempt-runner.js";
import {
  DEFAULT_TIMEOUTS,
  type UpstreamCall,
  UpstreamClient,
  type UpstreamStream,
  totalTimeoutMsOf,
} from "../../providers/upstream-client.js";
import { serviceTierSentTo } from "../../models/service-tier.js";
import { forwardedClientHeadersOf } from "../../providers/forwarded-client-headers.js";
import { UsageMeter } from "../../models/usage-meter.js";
import type {
  InferenceCaller,
  InferenceResult,
  RunInferenceTarget,
} from "../../models/inference.js";
import { RunInferenceCommand } from "../impl/run-inference.command.js";

/** What one Attempt needs besides the request and its target. */
interface AttemptOptions {
  destination: Destination;
  cacheKey: string;
  clientSignal: AbortSignal;
  clientHeaders: IncomingHttpHeaders;
  meter: UsageMeter;
}

/** What a successful Attempt hands back, before it is written for the client. */
type AttemptResult =
  | { kind: "response"; body: unknown }
  | { kind: "stream"; upstream: UpstreamStream; writer: ClientStreamWriter; target: AttemptTarget };

const HTTP_OK = 200;

/**
 * The inference path (spec "Inference path" steps 2 to 8) for any client
 * Protocol: parse, resolve the Model (or, for a direct Upstream Model test,
 * the Upstream Model), select the capable Routes, then make
 * Attempts with Fallback until one answers, and translate back. Reads only
 * the in-memory snapshot and a local copy of the Cooldown state in Redis.
 */
@CommandHandler(RunInferenceCommand)
export class RunInferenceHandler implements ICommandHandler<RunInferenceCommand> {
  constructor(
    private readonly snapshot: SnapshotService,
    private readonly upstream: UpstreamClient,
    private readonly attempts: AttemptRunner,
    private readonly usage: UsageProducer,
  ) {}

  async execute({
    converter,
    body,
    caller,
    connection,
    onUsage,
    target,
  }: RunInferenceCommand): Promise<InferenceResult> {
    const meter = new UsageMeter(
      requestOwnerOf(caller),
      converter.protocol,
      connection.requestBytes,
      connection.sender,
    );
    meter.requestReceived(connection.requestHeaders, body);
    const record = (job: UsageJob): void => {
      this.usage.enqueue(job);
      onUsage(job);
    };
    try {
      const result = await this.serve(converter, body, caller, target, connection, meter);
      if (result.kind === "stream") {
        return {
          kind: "stream",
          chunks: this.relayStream(result, converter, meter, connection.signal, record),
        };
      }
      const json = encodedFor(meter, JSON.stringify(result.body));
      record(meter.finish(HTTP_OK, false));
      return { kind: "response", json };
    } catch (error) {
      record(failedRequestUsage(meter, (failure) => converter.writeError(failure), error));
      throw error;
    }
  }

  private async serve(
    converter: ClientProtocolConverter,
    body: unknown,
    caller: InferenceCaller,
    inferenceTarget: RunInferenceTarget,
    connection: ClientConnection,
    meter: UsageMeter,
  ): Promise<AttemptResult> {
    const clientRequest = converter.parseRequest(body);
    meter.requestParsed(clientRequest.stream !== null);
    const destination = this.resolve(inferenceTarget, clientRequest, converter, caller, meter);
    const context: ResponseContext = {
      requestId: randomUUID().replaceAll("-", ""),
      modelName: destination.name,
      createdAt: new Date(),
    };
    const cacheKey = promptCacheKey(requestOwnerOf(caller), destination.id);

    return await this.attempts.answer(destination, meter, (target) => {
      const request = upstreamRequestFor(clientRequest, destination.model, target);
      return {
        sentServiceTier: serviceTierSentTo(request.serviceTier, target.upstreamModel),
        send: (credential) =>
          this.attempt(converter, request, context, target, credential, {
            cacheKey,
            clientSignal: connection.signal,
            clientHeaders: connection.requestHeaders,
            destination,
            meter,
          }),
      };
    });
  }

  private resolve(
    inferenceTarget: RunInferenceTarget,
    clientRequest: InferenceRequest,
    converter: ClientProtocolConverter,
    caller: InferenceCaller,
    meter: UsageMeter,
  ): Destination {
    const kind = CLIENT_PROTOCOL_KINDS[converter.protocol];
    switch (inferenceTarget.kind) {
      case "named-model":
        return this.resolveNamedModel(clientRequest, kind, caller, meter);
      case "upstream-model":
        return this.resolveUpstreamModel(inferenceTarget.upstreamModelId, kind, clientRequest);
      case "probe":
        return probeDestination(this.snapshot.current, inferenceTarget, kind);
    }
  }

  /** The Model the request names, with its capable Routes (spec steps 3 to 5). */
  private resolveNamedModel(
    clientRequest: InferenceRequest,
    kind: ModelKind,
    caller: InferenceCaller,
    meter: UsageMeter,
  ): Destination {
    const model = usableModel(this.snapshot.current, clientRequest.model, caller);
    meter.modelResolved(model.id, model.name);
    assertKindServedHere(`Model "${model.name}"`, model.kind, kind);
    // Routes are selected under the Model's policy (spec step 4 before 5); a
    // Route override applies only to the Attempts on its own Route.
    const routes = capableRoutes(model, applyParameterPolicy(clientRequest, model.parameterPolicy));
    if (routes.length === 0) {
      throw new GatewayError(
        "no_capable_route",
        `No Route of the Model "${model.name}" supports what this request needs`,
        "client",
      );
    }
    return {
      kind: "fallback",
      model,
      id: model.id,
      name: model.name,
      paths: routes.map(routePath),
    };
  }

  /**
   * The Upstream Model a direct Upstream Model test names by row id, if it
   * can serve the request as sent.
   */
  private resolveUpstreamModel(
    upstreamModelRowId: string,
    kind: ModelKind,
    clientRequest: InferenceRequest,
  ): Destination {
    const upstreamModel = upstreamModelServedHere(this.snapshot.current, upstreamModelRowId, kind);
    if (!canServe(upstreamModel, clientRequest)) {
      throw new GatewayError(
        "no_capable_route",
        `The Upstream Model "${upstreamModel.upstreamModelId}" does not support what this request needs`,
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

  /**
   * One upstream call. Throws AttemptFailedError while Fallback is still
   * possible: for a stream, until its first event has arrived.
   */
  private async attempt(
    converter: ClientProtocolConverter,
    request: InferenceRequest,
    context: ResponseContext,
    target: AttemptTarget,
    credential: ProviderAccountCredential,
    { meter, ...callOptions }: AttemptOptions,
  ): Promise<AttemptResult> {
    const call = this.upstreamCallFor(request, target, credential, callOptions);
    if (!request.stream) {
      const { response, upstreamRequestId } = await this.upstream.complete(call);
      meter.attemptAnswered(upstreamRequestId);
      meter.usageReported(response.usage, response.servedTierValue);
      meter.attemptSucceeded();
      return { kind: "response", body: converter.writeResponse(response, request, context) };
    }
    const upstream = await this.upstream.openStream(call);
    meter.attemptAnswered(upstream.upstreamRequestId);
    return { kind: "stream", upstream, writer: converter.startStream(request, context), target };
  }

  private upstreamCallFor(
    request: InferenceRequest,
    { route, upstreamModel }: AttemptTarget,
    credential: ProviderAccountCredential,
    { destination, cacheKey, clientSignal, clientHeaders }: Omit<AttemptOptions, "meter">,
  ): UpstreamCall {
    const { provider } = upstreamModel;
    const quirks = validQuirksOf(provider);
    const sentServiceTier = serviceTierSentTo(request.serviceTier, upstreamModel);
    const endpoint = endpointOf(upstreamModel);
    const converter = endpoint && UPSTREAM_PROTOCOL_CONVERTERS[endpoint.protocol];
    if (!endpoint || !converter) {
      // canServe() already skips these Upstream Models.
      throw new Error(
        `The Provider ${provider.slug} has no ${upstreamModel.kind} endpoint the gateway can call`,
      );
    }
    return {
      converter,
      request,
      target: {
        baseUrl: endpoint.baseUrl,
        upstreamModelId: upstreamModel.upstreamModelId,
        quirks,
        maxOutputTokens: upstreamModel.maxOutputTokens ?? undefined,
        promptCacheKey: cacheKey,
        ...(sentServiceTier && { serviceTierValue: sentServiceTier.wireValue }),
      },
      authHeaders: {
        ...credential.identityHeaders,
        ...upstreamAuthHeaders(provider.authStyle, credential.secret),
      },
      forwardedHeaders: forwardedClientHeadersOf(quirks, clientHeaders),
      timeouts: {
        connectMs: route?.connectTimeoutMs ?? DEFAULT_TIMEOUTS.connectMs,
        firstTokenMs: route?.firstTokenTimeoutMs ?? DEFAULT_TIMEOUTS.firstTokenMs,
        totalMs: totalTimeoutMsOf(destination, route),
      },
      clientSignal,
    };
  }

  /**
   * Relays an open upstream stream to the client: the events of one network
   * read go out as one chunk. A failure after the first chunk reached the
   * client gets no Fallback (spec "Fallback"): the client Protocol's error
   * event ends the stream instead. Records the usage job however it ends;
   * the status went out with the first chunk.
   */
  private async *relayStream(
    { upstream, writer, target }: Extract<AttemptResult, { kind: "stream" }>,
    converter: ClientProtocolConverter,
    meter: UsageMeter,
    clientSignal: AbortSignal,
    record: (job: UsageJob) => void,
  ): AsyncIterable<Uint8Array> {
    let text = "";
    try {
      try {
        text = writer.start();
        for (let batch = await upstream.nextBatch(); batch; batch = await upstream.nextBatch()) {
          for (const event of batch) {
            if (event.type === "usage") {
              meter.usageReported(event.usage, event.servedTierValue);
            }
            text += writer.write(event);
          }
          if (text !== "") {
            yield encodedFor(meter, text);
            text = "";
          }
        }
        meter.attemptSucceeded();
        text += writer.end();
      } catch (error) {
        if (error instanceof ClientCancelledError) {
          return;
        }
        if (error instanceof GatewayError) {
          // The writer refused what the upstream sent (interleaved tool call
          // arguments): the stream is broken, but the client still gets the
          // Protocol's error event instead of a torn connection.
          meter.attemptInterrupted();
          meter.failedWith(error);
          text += converter.writeStreamError(error);
          yield encodedFor(meter, text);
          return;
        }
        if (!(error instanceof AttemptFailedError)) {
          throw error;
        }
        meter.attemptFailed(error);
        await this.attempts.afterFailedAttempt(error, target);
        const gatewayError = gatewayErrorFor(error);
        meter.failedWith(gatewayError);
        text += converter.writeStreamError(gatewayError);
      }
      if (text !== "") {
        yield encodedFor(meter, text);
      }
    } finally {
      upstream.close();
      record(meter.finish(HTTP_OK, clientSignal.aborted));
    }
  }
}

/**
 * What the upstream gets for one Attempt. The Parameter Policy is applied on
 * the internal format, before any upstream translation, so it works the same
 * for every client and upstream Protocol. A direct Upstream Model test has no
 * Model, so its request goes upstream as the Playground sent it.
 */
function upstreamRequestFor(
  clientRequest: InferenceRequest,
  model: SnapshotModel | null,
  { route, upstreamModel }: AttemptTarget,
): InferenceRequest {
  if (!model) {
    return clientRequest;
  }
  const policed = applyParameterPolicy(
    clientRequest,
    effectiveParameterPolicy(model.parameterPolicy, route?.parameterPolicyOverride ?? null),
  );
  return withCacheBreakpointsFor(model, upstreamModel, policed);
}

/**
 * Spec "Cache behavior": automatic breakpoints are for anthropic-messages
 * upstreams, when the Model has them on. Added after the Parameter Policy, so
 * its system prompt counts as part of the system prompt.
 */
function withCacheBreakpointsFor(
  model: SnapshotModel,
  upstreamModel: SnapshotUpstreamModel,
  request: InferenceRequest,
): InferenceRequest {
  const { provider } = upstreamModel;
  if (
    !model.hasAutomaticCacheBreakpoints ||
    provider.endpoints.chat?.protocol !== "anthropic-messages"
  ) {
    return request;
  }
  const { cacheMarkerLimit } = validQuirksOf(provider);
  return withAutomaticCacheBreakpoints(request, cacheMarkerLimit ?? DEFAULT_CACHE_MARKER_LIMIT);
}
