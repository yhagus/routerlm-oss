import { createHash } from "node:crypto";
import type { UsageCaller } from "@/usage/models/usage-job.js";

export type PromptCacheKeyOwner = Exclude<UsageCaller, { kind: "unidentified" }>;

export function promptCacheKey(owner: PromptCacheKeyOwner, destinationId: string): string {
  const ownerId = owner.kind === "api-key" ? owner.apiKeyId : owner.userId;
  return createHash("sha256")
    .update(`${owner.kind}:${ownerId}:${destinationId}`)
    .digest("base64url");
}
