import { randomUUID } from "node:crypto";
import { Injectable, Logger } from "@nestjs/common";
import { type ApiKeyPrincipal, mayUseModel } from "../api-keys/api-key.js";
import type { SnapshotModel, SnapshotRoute } from "../snapshot/snapshot.js";
import { SnapshotService } from "../snapshot/snapshot.service.js";
import { CooldownStore } from "../upstream/cooldown-store.js";
import type { UsageJob } from "../usage/usage-job.js";
import { UsageProducer } from "../usage/usage.producer.js";
import { ProviderAccountHealth } from "../upstream/provider-account-health.js";
import { ProviderKeyCipher } from "../upstream/provider-key-cipher.js";
import {
  AttemptFailedError,
  ClientCancelledError,
  exhaustionError,
  gatewayErrorFor,
} from "./attempt-failure.js";
import { GatewayError } from "./gateway-error.js";
import type { InferenceRequest, InferenceStreamEvent } from "./internal-format.js";
import { applyParameterPolicy, effectiveParameterPolicy } from "./parameter-policy.js";
import {
  type ClientProtocolConverter,
  type ResponseContext,
  writeClientStream,
} from "./protocols/client-protocol-converter.js";
import { UPSTREAM_PROTOCOL_CONVERTERS, upstreamAuthHeaders } from "./protocols/converters.js";
import { type AttemptTarget, attemptTargets, capableRoutes } from "./route-selection.js";
import { DEFAULT_TIMEOUTS, type UpstreamCall, UpstreamClient } from "./upstream-client.js";
import { UsageMeter } from "./usage-meter.js";
import type { ClientConnection } from "./client-connection.js";

/** What the client gets back: a JSON body, or the text of an event stream. */
export type InferenceResult =
  | { kind: "response"; body: unknown }
  | { kind: "stream"; chunks: AsyncIterable<string> };

/** Spec "Fallback": at most this many upstream calls per client request. */
export const MAX_ATTEMPTS_PER_REQUEST = 5;

const HTTP_OK = 200;
const HTTP_INTERNAL_SERVER_ERROR = 500;
/** Recorded when the client left before any response; nginx's "client closed request". */
const CLIENT_CLOSED_REQUEST = 499;

/**
 * The inference path (spec "Inference path" steps 2 to 8) for any client
 * Protocol: parse, resolve the Model, select the capable Routes, then make
 * Attempts with Fallback until one answers, and translate back. Reads only
 * the in-memory snapshot and the Cooldown state in Redis.
 */
@Injectable()
export class InferenceService {
  private readonly logger = new Logger(InferenceService.name);

  constructor(
    private readonly snapshot: SnapshotService,
    private readonly cipher: ProviderKeyCipher,
    private readonly upstream: UpstreamClient,
    private readonly cooldowns: CooldownStore,
    private readonly providerAccountHealth: ProviderAccountHealth,
    private readonly usage: UsageProducer,
  ) {}

  /** Serves the request and enqueues its usage job once it is answered (spec step 9). */
  async infer(
    converter: ClientProtocolConverter,
    body: unknown,
    principal: ApiKeyPrincipal,
    client: ClientConnection,
  ): Promise<InferenceResult> {
    const meter = new UsageMeter(
      { kind: "api-key", apiKeyId: principal.apiKeyId },
      converter.protocol,
      client.requestBytes,
    );
    try {
      const result = await this.serve(converter, body, principal, client.signal, meter);
      if (result.kind === "stream") {
        return { kind: "stream", chunks: this.meteredStream(result.chunks, meter, client.signal) };
      }
      meter.responseWritten(JSON.stringify(result.body));
      this.usage.enqueue(meter.finish(HTTP_OK, false));
      return result;
    } catch (error) {
      this.usage.enqueue(failedRequestUsage(meter, converter, error));
      throw error;
    }
  }

  private async serve(
    converter: ClientProtocolConverter,
    body: unknown,
    principal: ApiKeyPrincipal,
    clientSignal: AbortSignal,
    meter: UsageMeter,
  ): Promise<InferenceResult> {
    const clientRequest = converter.parseRequest(body);
    meter.requestParsed(clientRequest.stream !== null);
    const model = this.resolveModel(clientRequest.model, principal);
    meter.modelResolved(model.id);
    // Routes are selected under the Model's policy (spec step 4 before 5); a
    // Route override applies only to the Attempts on its own Route.
    const routes = capableRoutes(model, applyParameterPolicy(clientRequest, model.parameterPolicy));
    if (routes.length === 0) {
      throw new GatewayError(
        "no_capable_route",
        `No Route of the Model "${model.name}" supports what this request needs`,
      );
    }
    const context: ResponseContext = {
      requestId: randomUUID().replaceAll("-", ""),
      modelName: model.name,
      createdAt: new Date(),
    };

    // Accounts in Cooldown when the request arrived, plus the ones that fail during it.
    const skippedAccountIds = new Set(
      (await this.cooldowns.cooldownEnds(providerAccountIdsOf(routes))).keys(),
    );
    const failures: AttemptFailedError[] = [];
    const targets = attemptTargets(routes, (account) => skippedAccountIds.has(account.id));
    for (const target of targets) {
      if (failures.length === MAX_ATTEMPTS_PER_REQUEST) {
        break;
      }
      // Applied on the internal format, before any upstream translation, so it
      // works the same for every client and upstream Protocol.
      const request = applyParameterPolicy(
        clientRequest,
        effectiveParameterPolicy(model.parameterPolicy, target.route.parameterPolicyOverride),
      );
      meter.attemptStarted(target);
      try {
        return await this.attempt(converter, request, context, target, clientSignal, meter);
      } catch (error) {
        if (!(error instanceof AttemptFailedError)) {
          throw error;
        }
        meter.attemptFailed(error);
        failures.push(error);
        skippedAccountIds.add(target.providerAccount.id);
        await this.afterFailedAttempt(error, target);
        if (error.reason === "bad_request") {
          // The request itself is bad: another Provider Account would refuse it too.
          throw gatewayErrorFor(error);
        }
      }
    }
    throw exhaustionError(failures);
  }

  /** The Model the request names, if this API Key may use it (spec step 3). */
  private resolveModel(name: string, principal: ApiKeyPrincipal): SnapshotModel {
    const model = this.snapshot.current.modelsByName.get(name);
    if (!model?.isEnabled) {
      throw new GatewayError("model_not_found", `The Model "${name}" does not exist`);
    }
    if (!mayUseModel(principal, model.id)) {
      throw new GatewayError("model_not_allowed", `This API Key may not use the Model "${name}"`);
    }
    return model;
  }

  /**
   * One Attempt. Throws AttemptFailedError while Fallback is still possible:
   * for a stream, until its first event has arrived.
   */
  private async attempt(
    converter: ClientProtocolConverter,
    request: InferenceRequest,
    context: ResponseContext,
    target: AttemptTarget,
    clientSignal: AbortSignal,
    meter: UsageMeter,
  ): Promise<InferenceResult> {
    const call = this.upstreamCallFor(request, target, clientSignal);
    if (!request.stream) {
      const response = await this.upstream.complete(call);
      meter.attemptAnswered();
      meter.usageReported(response.usage);
      meter.attemptSucceeded();
      return { kind: "response", body: converter.writeResponse(response, request, context) };
    }
    const events = await this.upstream.openStream(call);
    meter.attemptAnswered();
    return {
      kind: "stream",
      chunks: writeClientStream(
        converter,
        this.reportingFailures(events, target, meter),
        request,
        context,
      ),
    };
  }

  private upstreamCallFor(
    request: InferenceRequest,
    { route, providerAccount }: AttemptTarget,
    clientSignal: AbortSignal,
  ): UpstreamCall {
    const { upstreamModel } = route;
    const { provider } = upstreamModel;
    const converter = UPSTREAM_PROTOCOL_CONVERTERS[provider.protocol];
    if (!converter) {
      // capableRoutes() already skips these Routes.
      throw new Error(`No converter for the upstream Protocol ${provider.protocol}`);
    }
    return {
      converter,
      request,
      target: {
        baseUrl: provider.baseUrl,
        upstreamModelId: upstreamModel.upstreamModelId,
        quirks: provider.quirks,
        maxOutputTokens: upstreamModel.maxOutputTokens ?? undefined,
      },
      authHeaders: upstreamAuthHeaders(
        provider.authStyle,
        this.cipher.decrypt(providerAccount.encryptedKey),
      ),
      timeouts: {
        connectMs: route.connectTimeoutMs ?? DEFAULT_TIMEOUTS.connectMs,
        firstTokenMs: route.firstTokenTimeoutMs ?? DEFAULT_TIMEOUTS.firstTokenMs,
        totalMs: route.totalTimeoutMs ?? DEFAULT_TIMEOUTS.totalMs,
      },
      clientSignal,
    };
  }

  /**
   * A failure after the first chunk reached the client gets no Fallback
   * (spec "Fallback"): it becomes a GatewayError, which `writeClientStream`
   * writes as the client Protocol's error event.
   */
  private async *reportingFailures(
    events: AsyncIterable<InferenceStreamEvent>,
    target: AttemptTarget,
    meter: UsageMeter,
  ): AsyncIterable<InferenceStreamEvent> {
    try {
      for await (const event of events) {
        if (event.type === "usage") {
          meter.usageReported(event.usage);
        }
        yield event;
      }
      meter.attemptSucceeded();
    } catch (error) {
      if (error instanceof ClientCancelledError) {
        return;
      }
      if (!(error instanceof AttemptFailedError)) {
        throw error;
      }
      meter.attemptFailed(error);
      await this.afterFailedAttempt(error, target);
      const gatewayError = gatewayErrorFor(error);
      meter.failedWith(gatewayError.code);
      throw gatewayError;
    }
  }

  /** Counts the bytes sent and enqueues the usage job when the stream ends, however it ends. */
  private async *meteredStream(
    chunks: AsyncIterable<string>,
    meter: UsageMeter,
    clientSignal: AbortSignal,
  ): AsyncIterable<string> {
    try {
      for await (const chunk of chunks) {
        meter.responseWritten(chunk);
        yield chunk;
      }
    } finally {
      // The status went out with the first chunk; a later failure is an error event.
      this.usage.enqueue(meter.finish(HTTP_OK, clientSignal.aborted));
    }
  }

  /**
   * What a failed Attempt does to its Provider Account (spec "Fallback"):
   * 401/403 disable it until an operator re-enables it; rate limits, 5xx,
   * timeouts and connection errors put it in Cooldown; a bad request says
   * nothing about the account. The database writes are not awaited.
   */
  private async afterFailedAttempt(
    failure: AttemptFailedError,
    { route, providerAccount }: AttemptTarget,
  ): Promise<void> {
    // Upstream error text stays in this log line and the dashboard, never in the reply.
    this.logger.warn(
      `Attempt failed (${failure.reason}, status ${failure.upstreamStatus ?? "none"}) ` +
        `on Route ${route.id}, Provider Account ${providerAccount.id}: ${failure.message}`,
    );
    const lastError = `${failure.reason}: ${failure.message}`;
    switch (failure.reason) {
      case "bad_request":
        return;
      case "unauthorized":
        void this.providerAccountHealth.disable(
          providerAccount.id,
          `The upstream refused this key (HTTP ${failure.upstreamStatus ?? "unknown"})`,
          lastError,
        );
        return;
      case "rate_limited":
      case "server_error":
      case "timeout":
      case "connection_error":
      case "stream_interrupted":
        void this.providerAccountHealth.recordFailure(providerAccount.id, lastError);
        await this.cooldowns.startCooldown(providerAccount.id, failure.retryAfter);
        return;
    }
  }
}

/** The usage job of a request that ended in an exception instead of a response. */
function failedRequestUsage(
  meter: UsageMeter,
  converter: ClientProtocolConverter,
  error: unknown,
): UsageJob {
  if (error instanceof GatewayError) {
    return meter.finishWithError(error, converter.writeError(error));
  }
  if (error instanceof ClientCancelledError) {
    return meter.finish(CLIENT_CLOSED_REQUEST, true);
  }
  // A bug: Nest answers 500.
  return meter.finish(HTTP_INTERNAL_SERVER_ERROR, false);
}

function providerAccountIdsOf(routes: SnapshotRoute[]): string[] {
  return routes.flatMap((route) =>
    route.upstreamModel.provider.providerAccounts.map((account) => account.id),
  );
}
