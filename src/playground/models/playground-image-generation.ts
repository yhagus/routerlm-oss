import type { PlaygroundSummary } from "./playground-summary.js";

export interface PlaygroundImageGeneration {
  response: unknown;
  summary: PlaygroundSummary;
}
