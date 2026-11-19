import type { PlaygroundSummary } from "./playground-summary.js";

/** What the Playground gets for a speech request. */
export interface PlaygroundSpeech {
  /** The audio a client would get as raw bytes, base64-encoded so it travels in JSON. */
  audio: { contentType: string; base64: string };
  summary: PlaygroundSummary;
}
