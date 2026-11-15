import { createHash } from "node:crypto";
import type { UsageCaller } from "@/usage/models/usage-job.js";

/**
 * Who a request is made for: a client's API Key, or a signed-in User in the
 * Playground, which has no API Key.
 */
export type PromptCacheKeyOwner = Exclude<UsageCaller, { kind: "unidentified" }>;

/**
 * Spec "Cache behavior": a key that stays the same for every request of one
 * owner to one destination, so a Provider that routes by it sends them to the
 * same cache. The destination is a Model's id or, for a direct Upstream Model
 * test, the Upstream Model's row id. It is a hash, so Providers never see our ids.
 */
export function promptCacheKey(owner: PromptCacheKeyOwner, destinationId: string): string {
  const ownerId = owner.kind === "api-key" ? owner.apiKeyId : owner.userId;
  return createHash("sha256")
    .update(`${owner.kind}:${ownerId}:${destinationId}`)
    .digest("base64url");
}
