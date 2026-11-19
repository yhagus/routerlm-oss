import type { ApiKeyPrincipal } from "@/api-keys/models/api-key.js";
import type { UsageJob } from "@/usage/models/usage-job.js";

/** What the client gets back: a JSON body, or an event stream, both already encoded. */
export type InferenceResult =
  | { kind: "response"; json: Uint8Array }
  | { kind: "stream"; chunks: AsyncIterable<Uint8Array> };

/**
 * Who sends an inference request: a client application with its API Key, or
 * a signed-in User from the Playground, who may use every enabled Model.
 */
export type InferenceCaller =
  | { kind: "api-key"; principal: ApiKeyPrincipal }
  | { kind: "playground"; userId: string };

/**
 * What a request is sent to: the Model its body names, or one Upstream Model
 * by its row id, with no Model in between (a direct Upstream Model test, which
 * only the Playground makes).
 */
export type InferenceTarget =
  | { kind: "named-model" }
  | { kind: "upstream-model"; upstreamModelId: string };

/**
 * A Probe's call (GLOSSARY "Probe"): one Attempt to an Upstream Model with
 * one Provider Account, whatever is disabled or in Cooldown, with no Fallback
 * and no effect on the account. Ends with a timeout after `totalTimeoutMs`.
 */
export interface ProbeTarget {
  kind: "probe";
  upstreamModelId: string;
  providerAccountId: string;
  totalTimeoutMs: number;
}

/** Called with the usage job once the request has ended, however it ended. */
export type UsageListener = (job: UsageJob) => void;
