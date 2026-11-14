import type { ApiKeyPrincipal } from "@/api-keys/models/api-key.js";
import type { UsageJob } from "@/usage/models/usage-job.js";

/** What the client gets back: a JSON body, or the text of an event stream. */
export type InferenceResult =
  | { kind: "response"; body: unknown }
  | { kind: "stream"; chunks: AsyncIterable<string> };

/**
 * Who sends an inference request: a client application with its API Key, or
 * a signed-in User from the Playground, who may use every enabled Model.
 */
export type InferenceCaller =
  | { kind: "api-key"; principal: ApiKeyPrincipal }
  | { kind: "playground"; userId: string };

/** Called with the usage job once the request has ended, however it ended. */
export type UsageListener = (job: UsageJob) => void;
