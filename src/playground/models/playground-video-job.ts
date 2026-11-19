import type { PlaygroundSummary } from "./playground-summary.js";

/** What the Playground gets for a submitted Video Job. */
export interface PlaygroundVideoJob {
  /** The OpenAI video object a client would get: `{id, object: "video", status: "queued", …}`. */
  response: unknown;
  summary: PlaygroundSummary;
}
