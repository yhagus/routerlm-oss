import type { PlaygroundSummary } from "./playground-summary.js";

/** What the Playground gets for an image request. */
export interface PlaygroundImageGeneration {
  /** The OpenAI Images response a client would get: `{created, data: [{b64_json}]}`. */
  response: unknown;
  summary: PlaygroundSummary;
}
