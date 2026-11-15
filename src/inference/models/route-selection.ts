import type { Capability } from "@/db/schemas/index.js";
import type {
  SnapshotModel,
  SnapshotProviderAccount,
  SnapshotRoute,
  SnapshotUpstreamModel,
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
  return model.routes.filter((route) => route.isEnabled && canServe(route.upstreamModel, request));
}

/**
 * Whether the Upstream Model can serve the request: enabled along with its
 * Provider, with every Capability the request needs, a context large enough,
 * and a Protocol the gateway can translate to.
 */
export function canServe(upstreamModel: SnapshotUpstreamModel, request: InferenceRequest): boolean {
  const { provider } = upstreamModel;
  const neededContext = estimatedPromptTokens(request) + (request.maxOutputTokens ?? 0);
  return (
    upstreamModel.isEnabled &&
    provider.isEnabled &&
    UPSTREAM_PROTOCOL_CONVERTERS[provider.protocol] !== undefined &&
    requiredCapabilities(request).every((capability) =>
      upstreamModel.capabilities.includes(capability),
    ) &&
    neededContext <= upstreamModel.contextSize
  );
}

/**
 * How Attempts reach an Upstream Model: through one of the Model's Routes, or,
 * for a direct Upstream Model test, through no Route at all.
 */
export interface AttemptPath {
  /** Null for a direct Upstream Model test. */
  route: SnapshotRoute | null;
  upstreamModel: SnapshotUpstreamModel;
}

/** The path, and the Provider Account, an Attempt goes to. */
export interface AttemptTarget extends AttemptPath {
  providerAccount: SnapshotProviderAccount;
}

/** The path through a Model's Route. */
export function routePath(route: SnapshotRoute): AttemptPath {
  return { route, upstreamModel: route.upstreamModel };
}

/**
 * Where the Attempts of a request go, in order (spec "Inference path" step 6):
 * each path's enabled Provider Accounts by priority, then the next path.
 * Always the first healthy one, never round-robin, because upstream caches are
 * per account. `isSkipped` is asked lazily, as each target comes up, so a
 * Provider Account that failed earlier in the same request is skipped on a
 * later Route of the same Provider.
 */
export function* attemptTargets(
  paths: AttemptPath[],
  isSkipped: (target: AttemptTarget) => boolean,
): Generator<AttemptTarget> {
  for (const path of paths) {
    for (const providerAccount of path.upstreamModel.provider.providerAccounts) {
      const target = { ...path, providerAccount };
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
