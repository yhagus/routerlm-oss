import type { ApiKeyPrincipal } from "@/api-keys/models/api-key";
import type { UsageJob } from "@/usage/models/usage-job";

export type InferenceResult =
  | { kind: "response"; json: Uint8Array }
  | { kind: "stream"; chunks: AsyncIterable<Uint8Array> };

export type InferenceCaller =
  | { kind: "api-key"; principal: ApiKeyPrincipal }
  | { kind: "playground"; userId: string };

export type InferenceTarget =
  | { kind: "named-model" }
  | { kind: "upstream-model"; upstreamModelId: string };

export interface ProbeTarget {
  kind: "probe";
  upstreamModelId: string;
  providerAccountId: string;
  totalTimeoutMs: number;
}

export type RunInferenceTarget = InferenceTarget | ProbeTarget;

export type UsageListener = (job: UsageJob) => void;
