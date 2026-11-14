import { randomUUID } from "node:crypto";
import { Injectable, Logger } from "@nestjs/common";
import { type ApiKeyPrincipal, mayUseModel } from "../api-keys/api-key.js";
import { providerQuirksSchema } from "../catalog/catalog.schema.js";
import type { SnapshotModel, SnapshotRoute } from "../snapshot/snapshot.js";
import { SnapshotService } from "../snapshot/snapshot.service.js";
import { CooldownStore } from "../upstream/cooldown-store.js";
import { ProviderAccountHealth } from "../upstream/provider-account-health.js";
import { ProviderKeyCipher } from "../upstream/provider-key-cipher.js";
import {
  AttemptFailedError,
  ClientCancelledError,
  exhaustionError,
  gatewayErrorFor,
} from "./attempt-failure.js";
import {
  DEFAULT_CACHE_MARKER_LIMIT,
  withAutomaticCacheBreakpoints,
} from "./automatic-cache-breakpoints.js";
import { GatewayError } from "./gateway-error.js";
import type { InferenceRequest, InferenceStreamEvent } from "./internal-format.js";
import { applyParameterPolicy, effectiveParameterPolicy } from "./parameter-policy.js";
import { promptCacheKey } from "./prompt-cache-key.js";
import {
  type ClientProtocolConverter,
  type ResponseContext,
  writeClientStream,
} from "./protocols/client-protocol-converter.js";
import { UPSTREAM_PROTOCOL_CONVERTERS, upstreamAuthHeaders } from "./protocols/converters.js";
import { type AttemptTarget, attemptTargets, capableRoutes } from "./route-selection.js";
import { DEFAULT_TIMEOUTS, type UpstreamCall, UpstreamClient } from "./upstream-client.js";

/** What the client gets back: a JSON body, or the text of an event stream. */
export type InferenceResult =
  | { kind: "response"; body: unknown }
  | { kind: "stream"; chunks: AsyncIterable<string> };

/** Spec "Fallback": at most this many upstream calls per client request. */
export const MAX_ATTEMPTS_PER_REQUEST = 5;

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
  ) {}

  async infer(
    converter: ClientProtocolConverter,
    body: unknown,
    principal: ApiKeyPrincipal,
    clientSignal: AbortSignal,
  ): Promise<InferenceResult> {
    const clientRequest = converter.parseRequest(body);
    const model = this.resolveModel(clientRequest.model, principal);
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
    const cacheKey = promptCacheKey({ kind: "api-key", apiKeyId: principal.apiKeyId }, model.id);

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
      const policed = applyParameterPolicy(
        clientRequest,
        effectiveParameterPolicy(model.parameterPolicy, target.route.parameterPolicyOverride),
      );
      const request = withCacheBreakpointsFor(model, target.route, policed);
      try {
        return await this.attempt(converter, request, context, target, cacheKey, clientSignal);
      } catch (error) {
        if (!(error instanceof AttemptFailedError)) {
          throw error;
        }
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
    cacheKey: string,
    clientSignal: AbortSignal,
  ): Promise<InferenceResult> {
    const call = this.upstreamCallFor(request, target, cacheKey, clientSignal);
    if (!request.stream) {
      const response = await this.upstream.complete(call);
      return { kind: "response", body: converter.writeResponse(response, request, context) };
    }
    const events = await this.upstream.openStream(call);
    return {
      kind: "stream",
      chunks: writeClientStream(
        converter,
        this.reportingFailures(events, target),
        request,
        context,
      ),
    };
  }

  private upstreamCallFor(
    request: InferenceRequest,
    { route, providerAccount }: AttemptTarget,
    cacheKey: string,
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
        promptCacheKey: cacheKey,
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
  ): AsyncIterable<InferenceStreamEvent> {
    try {
      yield* events;
    } catch (error) {
      if (error instanceof ClientCancelledError) {
        return;
      }
      if (!(error instanceof AttemptFailedError)) {
        throw error;
      }
      await this.afterFailedAttempt(error, target);
      throw gatewayErrorFor(error);
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

/**
 * Spec "Cache behavior": automatic breakpoints are for anthropic-messages
 * upstreams, when the Model has them on. Added after the Parameter Policy, so
 * its system prompt counts as part of the system prompt.
 */
function withCacheBreakpointsFor(
  model: SnapshotModel,
  route: SnapshotRoute,
  request: InferenceRequest,
): InferenceRequest {
  const { provider } = route.upstreamModel;
  if (!model.hasAutomaticCacheBreakpoints || provider.protocol !== "anthropic-messages") {
    return request;
  }
  const { cacheMarkerLimit } = providerQuirksSchema.parse(provider.quirks);
  return withAutomaticCacheBreakpoints(request, cacheMarkerLimit ?? DEFAULT_CACHE_MARKER_LIMIT);
}

function providerAccountIdsOf(routes: SnapshotRoute[]): string[] {
  return routes.flatMap((route) =>
    route.upstreamModel.provider.providerAccounts.map((account) => account.id),
  );
}
