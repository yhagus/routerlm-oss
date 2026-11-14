import { createHash } from "node:crypto";
import type { UsageCaller } from "../usage/models/usage-job.js";

/**
 * Who a request is made for: a client's API Key, or a signed-in User in the
 * Playground, which has no API Key.
 */
export type PromptCacheKeyOwner = Exclude<UsageCaller, { kind: "unidentified" }>;

/**
 * Spec "Cache behavior": a key that stays the same for every request of one
 * owner to one Model, so a Provider that routes by it sends them to the same
 * cache. It is a hash, so Providers never see our ids.
 */
export function promptCacheKey(owner: PromptCacheKeyOwner, modelId: string): string {
  const ownerId = owner.kind === "api-key" ? owner.apiKeyId : owner.userId;
  return createHash("sha256").update(`${owner.kind}:${ownerId}:${modelId}`).digest("base64url");
}
