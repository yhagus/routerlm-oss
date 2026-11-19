import type { PlaygroundSummary } from "./playground-summary.js";

/** What the Playground gets for a transcription request. */
export interface PlaygroundTranscription {
  /** The transcript, as a client asking for `response_format: "text"` gets it. */
  text: string;
  summary: PlaygroundSummary;
}
