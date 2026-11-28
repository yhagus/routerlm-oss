import { randomUUID } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';
import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { CLIENT_PROTOCOL_KINDS, type ModelKind } from '@/db/schemas';
import { quirksSentThrough } from '@/libs/models/provider-protocols';
import {
  type SnapshotModel,
  type SnapshotUpstreamModel,
  validQuirksOf,
} from '@/snapshot/models/snapshot';
import type { ClientConnection } from '@/libs/models/client-connection';
import { SnapshotService } from '@/snapshot/providers/snapshot.service';
import type { ProviderAccountCredential } from '@/upstream/models/provider-account-credential';
import type { UsageJob } from '@/usage/models/usage-job';
import { UsageProducer } from '@/usage/jobs/usage.producer';
import {
  AttemptFailedError,
  ClientCancelledError,
  gatewayErrorFor,
} from '@/inference/models/attempt-failure';
import {
  DEFAULT_CACHE_MARKER_LIMIT,
  withAutomaticCacheBreakpoints,
} from '@/inference/models/automatic-cache-breakpoints';
import {
  assertKindServedHere,
  clientModelTargetOf,
  type Destination,
  probeDestination,
  upstreamModelServedHere,
} from '@/inference/models/destination';
import { GatewayError } from '@/inference/models/gateway-error';
import type { InferenceRequest } from '@/inference/models/internal-format';
import {
  applyParameterPolicy,
  effectiveParameterPolicy,
} from '@/inference/models/parameter-policy';
import { promptCacheKey } from '@/inference/models/prompt-cache-key';
import { encodedFor, failedRequestUsage, requestOwnerOf } from '@/inference/models/request-usage';
import type {
  ClientProtocolConverter,
  ClientStreamWriter,
  ResponseContext,
} from '@/inference/protocols/client-protocol-converter';
import type { UpstreamProtocolConverter } from '@/inference/protocols/upstream-protocol-converter';
import {
  UPSTREAM_PROTOCOL_CONVERTERS,
  upstreamAuthHeaders,
} from '@/inference/protocols/converters';
import {
  type AttemptTarget,
  canServe,
  capableRoutes,
  routePath,
  UPSTREAM_PROTOCOL_SPOKEN_BY_CLIENT,
} from '@/inference/models/route-selection';
import { type CallableEndpoint, callableEndpointOf } from '@/inference/models/callable-endpoint';
import { AttemptRunner } from '@/inference/providers/attempt-runner';
import { CallerLimits } from '@/inference/providers/caller-limits';
import {
  DEFAULT_TIMEOUTS,
  type UpstreamCall,
  UpstreamClient,
  type UpstreamStream,
  totalTimeoutMsOf,
} from '@/inference/providers/upstream-client';
import { serviceTierSentTo } from '@/inference/models/service-tier';
import { forwardedClientHeadersOf } from '@/inference/providers/forwarded-client-headers';
import { UsageMeter } from '@/inference/models/usage-meter';
import type {
  InferenceCaller,
  InferenceResult,
  RunInferenceTarget,
} from '@/inference/models/inference';
import { RunInferenceCommand } from '@/inference/commands/impl/run-inference.command';

interface AttemptOptions {
  destination: Destination;
  cacheKey: string;
  clientSignal: AbortSignal;
  clientHeaders: IncomingHttpHeaders;
  meter: UsageMeter;
}

type AttemptEndpoint = CallableEndpoint<UpstreamProtocolConverter>;

type AttemptResult =
  | { kind: 'response'; body: unknown }
  | { kind: 'stream'; upstream: UpstreamStream; writer: ClientStreamWriter; target: AttemptTarget };

const HTTP_OK = 200;

@CommandHandler(RunInferenceCommand)
export class RunInferenceHandler implements ICommandHandler<RunInferenceCommand> {
  constructor(
    private readonly snapshot: SnapshotService,
    private readonly upstream: UpstreamClient,
    private readonly attempts: AttemptRunner,
    private readonly usage: UsageProducer,
    private readonly callerLimits: CallerLimits,
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
      if (result.kind === 'stream') {
        return {
          kind: 'stream',
          chunks: this.relayStream(result, converter, meter, connection.signal, record),
        };
      }
      const json = encodedFor(meter, JSON.stringify(result.body));
      record(meter.finish(HTTP_OK, false));
      return { kind: 'response', json };
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
    await this.callerLimits.assertWithinLimits(caller);
    const clientRequest = converter.parseRequest(body);
    meter.requestParsed(clientRequest.stream !== null);
    meter.toolsDefined(clientRequest.tools.length);
    const destination = this.resolve(inferenceTarget, clientRequest, converter, caller, meter);
    const context: ResponseContext = {
      requestId: randomUUID().replaceAll('-', ''),
      modelName: destination.name,
      createdAt: new Date(),
    };
    const cacheKey = promptCacheKey(requestOwnerOf(caller), destination.id);

    const preferredProtocol =
      destination.kind === 'probe'
        ? undefined
        : UPSTREAM_PROTOCOL_SPOKEN_BY_CLIENT[converter.protocol];
    return await this.attempts.answer(destination, meter, (target) => {
      const endpoint = callableEndpointOf(
        target.upstreamModel,
        UPSTREAM_PROTOCOL_CONVERTERS,
        preferredProtocol,
      );
      const request = upstreamRequestFor(clientRequest, destination.model, target, endpoint);
      return {
        upstreamProtocol: endpoint.protocol,
        sentServiceTier: serviceTierSentTo(
          request.serviceTier,
          target.upstreamModel,
          endpoint.protocol,
        ),
        send: (credential) =>
          this.attempt(converter, request, context, target, endpoint, credential, {
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
      case 'named-model':
        return this.resolveNamedModel(clientRequest, kind, caller, meter);
      case 'upstream-model':
        return this.resolveUpstreamModel(inferenceTarget.upstreamModelId, kind, clientRequest);
      case 'probe':
        return probeDestination(this.snapshot.current, inferenceTarget, kind);
    }
  }

  private resolveNamedModel(
    clientRequest: InferenceRequest,
    kind: ModelKind,
    caller: InferenceCaller,
    meter: UsageMeter,
  ): Destination {
    meter.modelRequested(clientRequest.model);
    const target = clientModelTargetOf(this.snapshot.current, clientRequest.model, caller);
    if (target.kind === 'upstream-model') {
      return this.resolveUpstreamModel(target.upstreamModel.id, kind, clientRequest);
    }
    const { model } = target;
    meter.modelResolved(model.id, model.name);
    assertKindServedHere(`Model "${model.name}"`, model.kind, kind);
    const routes = capableRoutes(model, applyParameterPolicy(clientRequest, model.parameterPolicy));
    if (routes.length === 0) {
      throw new GatewayError(
        'no_capable_route',
        `No Route of the Model "${model.name}" supports what this request needs`,
        'client',
      );
    }
    return {
      kind: 'fallback',
      model,
      id: model.id,
      name: model.name,
      paths: routes.map(routePath),
    };
  }

  private resolveUpstreamModel(
    upstreamModelRowId: string,
    kind: ModelKind,
    clientRequest: InferenceRequest,
  ): Destination {
    const upstreamModel = upstreamModelServedHere(this.snapshot.current, upstreamModelRowId, kind);
    if (!canServe(upstreamModel, clientRequest)) {
      throw new GatewayError(
        'no_capable_route',
        `The Upstream Model "${upstreamModel.upstreamModelId}" does not support what this request needs`,
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

  private async attempt(
    converter: ClientProtocolConverter,
    request: InferenceRequest,
    context: ResponseContext,
    target: AttemptTarget,
    endpoint: AttemptEndpoint,
    credential: ProviderAccountCredential,
    { meter, ...callOptions }: AttemptOptions,
  ): Promise<AttemptResult> {
    const call = this.upstreamCallFor(request, target, endpoint, credential, callOptions);
    if (!request.stream) {
      const { response, upstreamStatus, upstreamRequestId } = await this.upstream.complete(call);
      meter.attemptAnswered(upstreamStatus, upstreamRequestId);
      meter.parametersSent(request);
      meter.responseReceived(response);
      meter.attemptSucceeded();
      return { kind: 'response', body: converter.writeResponse(response, request, context) };
    }
    const upstream = await this.upstream.openStream(call);
    meter.attemptAnswered(upstream.upstreamStatus, upstream.upstreamRequestId);
    meter.parametersSent(request);
    return { kind: 'stream', upstream, writer: converter.startStream(request, context), target };
  }

  private upstreamCallFor(
    request: InferenceRequest,
    { route, upstreamModel }: AttemptTarget,
    endpoint: AttemptEndpoint,
    credential: ProviderAccountCredential,
    { destination, cacheKey, clientSignal, clientHeaders }: Omit<AttemptOptions, 'meter'>,
  ): UpstreamCall {
    const { provider } = upstreamModel;
    const quirks = quirksSentThrough(endpoint.protocol, validQuirksOf(provider));
    const sentServiceTier = serviceTierSentTo(
      request.serviceTier,
      upstreamModel,
      endpoint.protocol,
    );
    return {
      converter: endpoint.adapter,
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

  private async *relayStream(
    { upstream, writer, target }: Extract<AttemptResult, { kind: 'stream' }>,
    converter: ClientProtocolConverter,
    meter: UsageMeter,
    clientSignal: AbortSignal,
    record: (job: UsageJob) => void,
  ): AsyncIterable<Uint8Array> {
    let text = '';
    try {
      try {
        text = writer.start();
        for (let batch = await upstream.nextBatch(); batch; batch = await upstream.nextBatch()) {
          for (const event of batch) {
            meter.streamEventRelayed(event);
            text += writer.write(event);
          }
          if (text !== '') {
            yield encodedFor(meter, text);
            text = '';
          }
        }
        meter.attemptSucceeded();
        text += writer.end();
      } catch (error) {
        if (error instanceof ClientCancelledError) {
          return;
        }
        if (error instanceof GatewayError) {
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
      if (text !== '') {
        yield encodedFor(meter, text);
      }
    } finally {
      upstream.close();
      record(meter.finish(HTTP_OK, clientSignal.aborted));
    }
  }
}

function upstreamRequestFor(
  clientRequest: InferenceRequest,
  model: SnapshotModel | null,
  { route, upstreamModel }: AttemptTarget,
  endpoint: AttemptEndpoint,
): InferenceRequest {
  if (!model) {
    return clientRequest;
  }
  const policed = applyParameterPolicy(
    clientRequest,
    effectiveParameterPolicy(model.parameterPolicy, route?.parameterPolicyOverride ?? null),
  );
  return withCacheBreakpointsFor(model, upstreamModel, endpoint, policed);
}

function withCacheBreakpointsFor(
  model: SnapshotModel,
  upstreamModel: SnapshotUpstreamModel,
  endpoint: AttemptEndpoint,
  request: InferenceRequest,
): InferenceRequest {
  if (!model.hasAutomaticCacheBreakpoints || endpoint.protocol !== 'anthropic-messages') {
    return request;
  }
  const { cacheMarkerLimit } = validQuirksOf(upstreamModel.provider);
  return withAutomaticCacheBreakpoints(request, cacheMarkerLimit ?? DEFAULT_CACHE_MARKER_LIMIT);
}
