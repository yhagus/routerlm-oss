import { randomUUID } from "node:crypto";
import { Injectable, Logger } from "@nestjs/common";
import { type ApiKeyPrincipal, mayUseModel } from "../api-keys/api-key.js";
import type {
  SnapshotModel,
  SnapshotProviderAccount,
  SnapshotRoute,
} from "../snapshot/snapshot.js";
import { SnapshotService } from "../snapshot/snapshot.service.js";
import { ProviderKeyCipher } from "../upstream/provider-key-cipher.js";
import { AttemptFailedError, ClientCancelledError, gatewayErrorFor } from "./attempt-failure.js";
import { GatewayError } from "./gateway-error.js";
import type { InferenceRequest, InferenceStreamEvent } from "./internal-format.js";
import type {
  ClientProtocolConverter,
  ResponseContext,
} from "./protocols/client-protocol-converter.js";
import { UPSTREAM_PROTOCOL_CONVERTERS, upstreamAuthHeaders } from "./protocols/converters.js";
import { capableRoutes, firstUsableProviderAccount } from "./route-selection.js";
import { DEFAULT_TIMEOUTS, type UpstreamCall, UpstreamClient } from "./upstream-client.js";

/** What the client gets back: a JSON body, or the text of an event stream. */
export type InferenceResult =
  | { kind: "response"; body: unknown }
  | { kind: "stream"; chunks: AsyncIterable<string> };

/** The Route and Provider Account an Attempt goes to. */
interface AttemptTarget {
  route: SnapshotRoute;
  providerAccount: SnapshotProviderAccount;
}

/**
 * The inference path (spec "Inference path" steps 2 to 8) for any client
 * Protocol: parse, resolve the Model, select a Route and Provider Account,
 * call the upstream, translate back. Reads only the in-memory snapshot.
 */
@Injectable()
export class InferenceService {
  private readonly logger = new Logger(InferenceService.name);

  constructor(
    private readonly snapshot: SnapshotService,
    private readonly cipher: ProviderKeyCipher,
    private readonly upstream: UpstreamClient,
  ) {}

  async infer(
    converter: ClientProtocolConverter,
    body: unknown,
    principal: ApiKeyPrincipal,
    clientSignal: AbortSignal,
  ): Promise<InferenceResult> {
    const request = converter.parseRequest(body);
    const model = this.resolveModel(request.model, principal);
    const target = this.selectAttemptTarget(model, request);
    // Parameter Policy (#17) applies here, once the Route (and its override) is known.
    const call = this.upstreamCallFor(request, target, clientSignal);
    const context: ResponseContext = {
      requestId: randomUUID().replaceAll("-", ""),
      modelName: model.name,
      createdAt: new Date(),
    };

    try {
      if (!request.stream) {
        const response = await this.upstream.complete(call);
        return { kind: "response", body: converter.writeResponse(response, request, context) };
      }
      const events = await this.upstream.openStream(call);
      return {
        kind: "stream",
        chunks: converter.writeStream(this.reportingFailures(events, target), request, context),
      };
    } catch (error) {
      throw this.clientErrorFor(error, target);
    }
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

  /** The first capable Route that has a usable Provider Account (no Fallback yet: #12). */
  private selectAttemptTarget(model: SnapshotModel, request: InferenceRequest): AttemptTarget {
    const routes = capableRoutes(model, request);
    if (routes.length === 0) {
      throw new GatewayError(
        "no_capable_route",
        `No Route of the Model "${model.name}" supports what this request needs`,
      );
    }
    for (const route of routes) {
      const providerAccount = firstUsableProviderAccount(route);
      if (providerAccount) {
        return { route, providerAccount };
      }
    }
    throw new GatewayError("upstream_error", "No upstream is available for this Model");
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

  /** Turns a failure after the first chunk into a GatewayError the client converter can write. */
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
      throw this.clientErrorFor(error, target);
    }
  }

  private clientErrorFor(error: unknown, { route, providerAccount }: AttemptTarget): unknown {
    if (!(error instanceof AttemptFailedError)) {
      return error;
    }
    // Upstream error text stays in this log line (and later Error Captures), never in the reply.
    this.logger.warn(
      `Attempt failed (${error.reason}, status ${error.upstreamStatus ?? "none"}) ` +
        `on Route ${route.id}, Provider Account ${providerAccount.id}: ${error.message}`,
    );
    return gatewayErrorFor(error);
  }
}
