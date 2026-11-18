import { randomUUID } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";
import { HttpStatus, Logger } from "@nestjs/common";
import { CommandBus, CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { mayUseModel } from "@/api-keys/models/api-key.js";
import { storedProviderQuirksSchema } from "@/catalog/schemas/catalog.schema.js";
import { ReadProviderAccountQuotaCommand } from "@/quota-meters/commands/impl/read-provider-account-quota.command.js";
import type {
  SnapshotModel,
  SnapshotProviderAccount,
  SnapshotUpstreamModel,
} from "@/snapshot/models/snapshot.js";
import type { ClientConnection } from "@/libs/models/client-connection.js";
import { SnapshotService } from "@/snapshot/providers/snapshot.service.js";
import { MarkProviderAccountExhaustedCommand } from "@/upstream/commands/impl/mark-provider-account-exhausted.command.js";
import { SIGN_IN_AGAIN_REASON } from "@/upstream/models/oauth-login.js";
import {
  apiKeyCredential,
  CredentialUnavailableError,
  OauthLoginRefusedError,
  type ProviderAccountCredential,
} from "@/upstream/models/provider-account-credential.js";
import { CooldownStore } from "@/upstream/providers/cooldown-store.js";
import type { UsageJob } from "@/usage/models/usage-job.js";
import { UsageProducer } from "@/usage/jobs/usage.producer.js";
import { ProviderAccountCredentials } from "@/upstream/providers/provider-account-credentials.js";
import { ProviderAccountHealth } from "@/upstream/providers/provider-account-health.js";
import { ProviderKeyCipher } from "@/upstream/providers/provider-key-cipher.js";
import {
  AttemptFailedError,
  ClientCancelledError,
  exhaustionError,
  gatewayErrorFor,
} from "../../models/attempt-failure.js";
import {
  DEFAULT_CACHE_MARKER_LIMIT,
  withAutomaticCacheBreakpoints,
} from "../../models/automatic-cache-breakpoints.js";
import { GatewayError } from "../../models/gateway-error.js";
import { exhaustedUntilOf } from "../../models/quota-exhausted-error.js";
import type { InferenceRequest, InferenceStreamEvent } from "../../models/internal-format.js";
import { applyParameterPolicy, effectiveParameterPolicy } from "../../models/parameter-policy.js";
import { type PromptCacheKeyOwner, promptCacheKey } from "../../models/prompt-cache-key.js";
import {
  type ClientProtocolConverter,
  type ResponseContext,
  writeClientStream,
} from "../../protocols/client-protocol-converter.js";
import { UPSTREAM_PROTOCOL_CONVERTERS, upstreamAuthHeaders } from "../../protocols/converters.js";
import {
  type AttemptPath,
  type AttemptTarget,
  attemptTargets,
  canServe,
  capableRoutes,
  routePath,
} from "../../models/route-selection.js";
import {
  DEFAULT_TIMEOUTS,
  type UpstreamCall,
  UpstreamClient,
} from "../../providers/upstream-client.js";
import { serviceTierSentTo } from "../../models/service-tier.js";
import { forwardedClientHeadersOf } from "../../providers/forwarded-client-headers.js";
import { UsageMeter } from "../../models/usage-meter.js";
import type { InferenceCaller, InferenceResult, InferenceTarget } from "../../models/inference.js";
import { RunInferenceCommand } from "../impl/run-inference.command.js";

/** What a request resolved to (spec step 3), with the paths its Attempts may take. */
interface Destination {
  /** Null for a direct Upstream Model test: no Parameter Policy, no automatic cache breakpoints. */
  model: SnapshotModel | null;
  /** The Model's id, or the Upstream Model's row id for a direct test. */
  id: string;
  /** What the response names as its model. */
  name: string;
  /** Capable of serving the request, in the order they are tried. */
  paths: AttemptPath[];
}

/** What one Attempt needs besides the request and its target. */
interface AttemptOptions {
  cacheKey: string;
  clientSignal: AbortSignal;
  clientHeaders: IncomingHttpHeaders;
  meter: UsageMeter;
}

/** Spec "Fallback": at most this many upstream calls per client request. */
export const MAX_ATTEMPTS_PER_REQUEST = 5;

const HTTP_OK = 200;
const HTTP_INTERNAL_SERVER_ERROR = 500;
/** Recorded when the client left before any response; nginx's "client closed request". */
const CLIENT_CLOSED_REQUEST = 499;

/**
 * The inference path (spec "Inference path" steps 2 to 8) for any client
 * Protocol: parse, resolve the Model (or, for a direct Upstream Model test,
 * the Upstream Model), select the capable Routes, then make
 * Attempts with Fallback until one answers, and translate back. Reads only
 * the in-memory snapshot and the Cooldown state in Redis.
 */
@CommandHandler(RunInferenceCommand)
export class RunInferenceHandler implements ICommandHandler<RunInferenceCommand> {
  private readonly logger = new Logger(RunInferenceHandler.name);

  constructor(
    private readonly snapshot: SnapshotService,
    private readonly cipher: ProviderKeyCipher,
    private readonly credentials: ProviderAccountCredentials,
    private readonly upstream: UpstreamClient,
    private readonly cooldowns: CooldownStore,
    private readonly providerAccountHealth: ProviderAccountHealth,
    private readonly usage: UsageProducer,
    private readonly commandBus: CommandBus,
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
          chunks: meteredStream(result.chunks, meter, connection.signal, record),
        };
      }
      meter.responseWritten(JSON.stringify(result.body));
      record(meter.finish(HTTP_OK, false));
      return result;
    } catch (error) {
      record(failedRequestUsage(meter, converter, error));
      throw error;
    }
  }

  private async serve(
    converter: ClientProtocolConverter,
    body: unknown,
    caller: InferenceCaller,
    inferenceTarget: InferenceTarget,
    connection: ClientConnection,
    meter: UsageMeter,
  ): Promise<InferenceResult> {
    const clientRequest = converter.parseRequest(body);
    meter.requestParsed(clientRequest.stream !== null);
    const destination =
      inferenceTarget.kind === "upstream-model"
        ? this.resolveUpstreamModel(inferenceTarget.upstreamModelId, clientRequest)
        : this.resolveNamedModel(clientRequest, caller, meter);
    const context: ResponseContext = {
      requestId: randomUUID().replaceAll("-", ""),
      modelName: destination.name,
      createdAt: new Date(),
    };
    const cacheKey = promptCacheKey(requestOwnerOf(caller), destination.id);

    // Accounts in Cooldown when the request arrived, plus the ones that fail during it.
    const enabledAccountIds = enabledProviderAccountIdsOf(destination.paths);
    const cooldowns = await this.cooldowns.cooldowns(enabledAccountIds);
    const skippedAccountIds = new Set(cooldowns.keys());
    const recordedExhaustedAccountIds = new Set<string>();
    const failures: AttemptFailedError[] = [];
    const targets = attemptTargets(destination.paths, (target) => {
      const accountId = target.providerAccount.id;
      if (!skippedAccountIds.has(accountId)) {
        return false;
      }
      // Recorded once, even when the account comes up again on a later Route.
      if (
        cooldowns.get(accountId)?.cause === "exhausted" &&
        !recordedExhaustedAccountIds.has(accountId)
      ) {
        recordedExhaustedAccountIds.add(accountId);
        meter.attemptSkippedAsExhausted(target);
      }
      return true;
    });
    for (const target of targets) {
      if (failures.length === MAX_ATTEMPTS_PER_REQUEST) {
        break;
      }
      const request = upstreamRequestFor(clientRequest, destination.model, target);
      try {
        return await this.attemptWithCredential(converter, request, context, target, {
          cacheKey,
          clientSignal: connection.signal,
          clientHeaders: connection.requestHeaders,
          meter,
        });
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
    throw exhaustionError(
      failures,
      enabledAccountIds.map((id) => cooldowns.get(id)?.cause ?? null),
    );
  }

  /** The Model the request names, with its capable Routes (spec steps 3 to 5). */
  private resolveNamedModel(
    clientRequest: InferenceRequest,
    caller: InferenceCaller,
    meter: UsageMeter,
  ): Destination {
    const model = this.resolveModel(clientRequest.model, caller);
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
    return { model, id: model.id, name: model.name, paths: routes.map(routePath) };
  }

  /**
   * The Upstream Model a direct Upstream Model test names by row id, if it
   * and its Provider are enabled and it can serve the request as sent.
   */
  private resolveUpstreamModel(
    upstreamModelRowId: string,
    clientRequest: InferenceRequest,
  ): Destination {
    const upstreamModel = this.snapshot.current.upstreamModelsById.get(upstreamModelRowId);
    if (!upstreamModel?.isEnabled || !upstreamModel.provider.isUsable) {
      throw new GatewayError(
        "model_not_found",
        `The Upstream Model "${upstreamModelRowId}" does not exist`,
      );
    }
    if (!canServe(upstreamModel, clientRequest)) {
      throw new GatewayError(
        "no_capable_route",
        `The Upstream Model "${upstreamModel.upstreamModelId}" does not support what this request needs`,
      );
    }
    return {
      model: null,
      id: upstreamModel.id,
      name: upstreamModel.upstreamModelId,
      paths: [{ route: null, upstreamModel }],
    };
  }

  /** The Model the request names, if the caller may use it (spec step 3). */
  private resolveModel(name: string, caller: InferenceCaller): SnapshotModel {
    const model = this.snapshot.current.modelsByName.get(name);
    if (!model?.isEnabled) {
      throw new GatewayError("model_not_found", `The Model "${name}" does not exist`);
    }
    if (caller.kind === "api-key" && !mayUseModel(caller.principal, model.id)) {
      throw new GatewayError("model_not_allowed", `This API Key may not use the Model "${name}"`);
    }
    return model;
  }

  /**
   * One Attempt with the Provider Account's credential. An OAuth Login the
   * upstream answers with 401 is refreshed once and tried once more (spec
   * "OAuth Login"), as a second Attempt on the same Provider Account.
   */
  private async attemptWithCredential(
    converter: ClientProtocolConverter,
    request: InferenceRequest,
    context: ResponseContext,
    target: AttemptTarget,
    options: AttemptOptions,
  ): Promise<InferenceResult> {
    const { meter } = options;
    const account = target.providerAccount;
    const sentServiceTier = serviceTierSentTo(request.serviceTier, target.upstreamModel);
    meter.attemptStarted(target, sentServiceTier);
    const credential = await this.credentialOf(account);
    meter.credentialUsed(credential.secret);
    try {
      return await this.attempt(converter, request, context, target, credential, options);
    } catch (error) {
      if (!isRejectedOauthLogin(error, account)) {
        throw error;
      }
      this.logger.warn(
        `The Provider answered 401 to the OAuth Login of Provider Account ${account.id}; ` +
          "refreshing it and trying once more",
      );
      meter.attemptFailed(error);
      meter.attemptStarted(target, sentServiceTier);
      const renewed = await asAttemptFailure(() =>
        this.credentials.credentialAfterRejection(account.id, credential),
      );
      meter.credentialUsed(renewed.secret);
      return await this.attempt(converter, request, context, target, renewed, options);
    }
  }

  /**
   * An API key comes from the snapshot, as ever. An OAuth Login is read where
   * it is stored, and refreshed first when it is about to run out.
   */
  private credentialOf(account: SnapshotProviderAccount): Promise<ProviderAccountCredential> {
    if (account.credential.kind === "api-key") {
      return Promise.resolve(
        apiKeyCredential(this.cipher.decrypt(account.credential.encryptedKey)),
      );
    }
    return asAttemptFailure(() => this.credentials.credentialOf(account.id));
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
    { cacheKey, clientSignal, clientHeaders, meter }: AttemptOptions,
  ): Promise<InferenceResult> {
    const call = this.upstreamCallFor(request, target, credential, {
      cacheKey,
      clientSignal,
      clientHeaders,
    });
    if (!request.stream) {
      const response = await this.upstream.complete(call);
      meter.attemptAnswered();
      meter.usageReported(response.usage, response.servedTierValue);
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
    { route, upstreamModel }: AttemptTarget,
    credential: ProviderAccountCredential,
    {
      cacheKey,
      clientSignal,
      clientHeaders,
    }: Pick<AttemptOptions, "cacheKey" | "clientSignal" | "clientHeaders">,
  ): UpstreamCall {
    const { provider } = upstreamModel;
    const sentServiceTier = serviceTierSentTo(request.serviceTier, upstreamModel);
    const converter = UPSTREAM_PROTOCOL_CONVERTERS[provider.protocol];
    if (!converter) {
      // canServe() already skips these Upstream Models.
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
        ...(sentServiceTier && { serviceTierValue: sentServiceTier.wireValue }),
      },
      authHeaders: {
        ...credential.identityHeaders,
        ...upstreamAuthHeaders(provider.authStyle, credential.secret),
      },
      forwardedHeaders: forwardedClientHeadersOf(
        storedProviderQuirksSchema.parse(provider.quirks),
        clientHeaders,
      ),
      timeouts: {
        connectMs: route?.connectTimeoutMs ?? DEFAULT_TIMEOUTS.connectMs,
        firstTokenMs: route?.firstTokenTimeoutMs ?? DEFAULT_TIMEOUTS.firstTokenMs,
        totalMs: route?.totalTimeoutMs ?? DEFAULT_TIMEOUTS.totalMs,
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
          meter.usageReported(event.usage, event.servedTierValue);
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

  /**
   * What a failed Attempt does to its Provider Account (spec "Fallback"):
   * 401/403 disable it until an operator re-enables it or, for an OAuth
   * Login, signs in again; rate limits, 5xx,
   * timeouts and connection errors put it in Cooldown; running out of quota
   * makes it Exhausted; a bad request says nothing about the account. The
   * database writes and the quota reading are not awaited.
   */
  private async afterFailedAttempt(
    failure: AttemptFailedError,
    { route, upstreamModel, providerAccount }: AttemptTarget,
  ): Promise<void> {
    const path = route ? `Route ${route.id}` : `Upstream Model ${upstreamModel.id} (direct)`;
    // Upstream error text stays in this log line and the dashboard, never in the reply.
    this.logger.warn(
      `Attempt failed (${failure.reason}, status ${failure.upstreamStatus ?? "none"}) ` +
        `on ${path}, Provider Account ${providerAccount.id}: ${failure.message}`,
    );
    const lastError = `${failure.reason}: ${failure.message}`;
    switch (failure.reason) {
      case "bad_request":
        return;
      case "unauthorized":
        void this.providerAccountHealth.disable(
          providerAccount.id,
          providerAccount.credential.kind === "oauth-login"
            ? SIGN_IN_AGAIN_REASON
            : `The upstream refused this key (HTTP ${failure.upstreamStatus ?? "unknown"})`,
          lastError,
        );
        return;
      case "rate_limited":
      case "server_error":
      case "timeout":
      case "connection_error":
      case "stream_interrupted":
        void this.providerAccountHealth.recordFailure(providerAccount.id, lastError);
        await this.cooldowns.startCooldown(providerAccount.id, failure.reason, failure.retryAfter);
        return;
      case "exhausted":
        void this.providerAccountHealth.recordFailure(providerAccount.id, lastError);
        // Until the reset the refusal names; for a short while when it names none.
        await this.commandBus.execute(
          new MarkProviderAccountExhaustedCommand(
            providerAccount.id,
            exhaustedUntilOf(failure.upstreamResponse?.body ?? ""),
          ),
        );
        // Started only now, so the end a reading sets replaces the refusal's.
        void this.readQuota(providerAccount.id);
        return;
    }
  }

  /** A failed reading, or a Provider with no quota reader, leaves the short Exhausted state. */
  private async readQuota(providerAccountId: string): Promise<void> {
    try {
      await this.commandBus.execute(new ReadProviderAccountQuotaCommand(providerAccountId));
    } catch (error) {
      this.logger.warn(
        `Quota of Exhausted Provider Account ${providerAccountId} not read: ${String(error)}`,
      );
    }
  }
}

/** Whether the upstream answered 401 to an OAuth Login, which one refresh may cure. */
function isRejectedOauthLogin(
  error: unknown,
  account: SnapshotProviderAccount,
): error is AttemptFailedError {
  return (
    account.credential.kind === "oauth-login" &&
    error instanceof AttemptFailedError &&
    error.upstreamStatus === HttpStatus.UNAUTHORIZED
  );
}

/**
 * Reads an OAuth Login's credential, turning what keeps it from being read
 * into a failed Attempt, so Fallback moves on: a login the Provider refuses
 * counts as unauthorized, one that can't be refreshed for now as a
 * connection error.
 */
async function asAttemptFailure(
  readCredential: () => Promise<ProviderAccountCredential>,
): Promise<ProviderAccountCredential> {
  try {
    return await readCredential();
  } catch (error) {
    if (error instanceof OauthLoginRefusedError) {
      throw new AttemptFailedError("unauthorized", null, error.message, null, { cause: error });
    }
    if (error instanceof CredentialUnavailableError) {
      throw new AttemptFailedError("connection_error", null, error.message, null, { cause: error });
    }
    throw error;
  }
}

/** The API Key or User a request is made for, as its Usage Log and prompt cache key name it. */
function requestOwnerOf(caller: InferenceCaller): PromptCacheKeyOwner {
  return caller.kind === "api-key"
    ? { kind: "api-key", apiKeyId: caller.principal.apiKeyId }
    : { kind: "playground", userId: caller.userId };
}

/** Counts the bytes sent and records the usage job when the stream ends, however it ends. */
async function* meteredStream(
  chunks: AsyncIterable<string>,
  meter: UsageMeter,
  clientSignal: AbortSignal,
  record: (job: UsageJob) => void,
): AsyncIterable<string> {
  try {
    for await (const chunk of chunks) {
      meter.responseWritten(chunk);
      yield chunk;
    }
  } finally {
    // The status went out with the first chunk; a later failure is an error event.
    record(meter.finish(HTTP_OK, clientSignal.aborted));
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
  if (!model.hasAutomaticCacheBreakpoints || provider.protocol !== "anthropic-messages") {
    return request;
  }
  const { cacheMarkerLimit } = storedProviderQuirksSchema.parse(provider.quirks);
  return withAutomaticCacheBreakpoints(request, cacheMarkerLimit ?? DEFAULT_CACHE_MARKER_LIMIT);
}

/** The Provider Accounts Fallback may try, unless they are in Cooldown. */
function enabledProviderAccountIdsOf(paths: AttemptPath[]): string[] {
  return paths.flatMap(({ upstreamModel }) =>
    upstreamModel.provider.providerAccounts
      .filter((account) => account.isEnabled)
      .map((account) => account.id),
  );
}
