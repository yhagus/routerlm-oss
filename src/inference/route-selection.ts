import type { Capability } from "../db/schema.js";
import type {
  SnapshotModel,
  SnapshotProviderAccount,
  SnapshotRoute,
} from "../snapshot/snapshot.js";
import type { InferenceRequest } from "./internal-format.js";
import { UPSTREAM_PROTOCOL_CONVERTERS } from "./protocols/converters.js";

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

/**
 * The Provider Account an Attempt on this Route uses: always the first healthy
 * one by priority, never round-robin, because upstream caches are per account.
 */
export function firstUsableProviderAccount(
  route: SnapshotRoute,
): SnapshotProviderAccount | undefined {
  // Cooldown (#12) also makes an account unusable.
  return route.upstreamModel.provider.providerAccounts.find((account) => account.isEnabled);
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
