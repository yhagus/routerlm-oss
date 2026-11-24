import type { PlaygroundSummary } from "./playground-summary.js";

export interface PlaygroundSpeech {
  audio: { contentType: string; base64: string };
  summary: PlaygroundSummary;
}
