import type { Capability } from "@/db/schemas/index.js";
import type {
  SnapshotModel,
  SnapshotProviderAccount,
  SnapshotRoute,
} from "@/snapshot/models/snapshot.js";
import type { InferenceRequest } from "./internal-format.js";
import { UPSTREAM_PROTOCOL_CONVERTERS } from "../protocols/converters.js";

// A rough, deliberately low token estimate for the context-size check:
// skipping a Route that could have served the request is worse than letting
// the upstream refuse one that is slightly too long.
const CHARACTERS_PER_TOKEN = 4;

/** The Capabilities an Upstream Model must have to serve the request. */
export function requiredCapabilities(request: InferenceRequest): Capability[] {
  const required: Capability[] = [];
  const hasImage = request.messages.some(
    (message) =>
      message.role !== "assistant" && message.content.some((part) => part.type === "image"),
  );
  if (hasImage) {
    required.push("vision");
  }
  if (request.tools.length > 0) {
    required.push("tools");
  }
  if (request.reasoning) {
    required.push("reasoning");
  }
  if (request.responseFormat?.type === "json-schema") {
    required.push("structured-output");
  }
  return required;
}

/**
 * The Model's Routes that can serve the request, in the order they are tried
 * (spec "Inference path" step 5): enabled all the way to the Provider, with
 * every Capability the request needs, a context large enough, and a Protocol
 * the gateway can translate to. Provider Accounts are not looked at here.
 */
export function capableRoutes(model: SnapshotModel, request: InferenceRequest): SnapshotRoute[] {
  const required = requiredCapabilities(request);
  const neededContext = estimatedPromptTokens(request) + (request.maxOutputTokens ?? 0);
  return model.routes.filter((route) => {
    const { upstreamModel } = route;
    const { provider } = upstreamModel;
    return (
      route.isEnabled &&
      upstreamModel.isEnabled &&
      provider.isEnabled &&
      UPSTREAM_PROTOCOL_CONVERTERS[provider.protocol] !== undefined &&
      required.every((capability) => upstreamModel.capabilities.includes(capability)) &&
      neededContext <= upstreamModel.contextSize
    );
  });
}

/** The Route and Provider Account an Attempt goes to. */
export interface AttemptTarget {
  route: SnapshotRoute;
  providerAccount: SnapshotProviderAccount;
}

/**
 * Where the Attempts of a request go, in order (spec "Inference path" step 6):
 * each Route's enabled Provider Accounts by priority, then the next Route.
 * Always the first healthy one, never round-robin, because upstream caches are
 * per account. `isSkipped` is asked lazily, as each target comes up, so a
 * Provider Account that failed earlier in the same request is skipped on a
 * later Route of the same Provider.
 */
export function* attemptTargets(
  routes: SnapshotRoute[],
  isSkipped: (target: AttemptTarget) => boolean,
): Generator<AttemptTarget> {
  for (const route of routes) {
    for (const providerAccount of route.upstreamModel.provider.providerAccounts) {
      const target = { route, providerAccount };
      if (providerAccount.isEnabled && !isSkipped(target)) {
        yield target;
      }
    }
  }
}

function estimatedPromptTokens(request: InferenceRequest): number {
  let characters = request.system.reduce((sum, part) => sum + part.text.length, 0);
  for (const message of request.messages) {
    for (const part of message.content) {
      if (part.type === "text" || part.type === "reasoning") {
        characters += part.text.length;
      } else if (part.type === "tool-call") {
        characters += part.arguments.length;
      }
    }
  }
  return Math.floor(characters / CHARACTERS_PER_TOKEN);
}
