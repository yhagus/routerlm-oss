import type { PlaygroundSummary } from './playground-summary';

export interface PlaygroundSpeech {
  audio: { contentType: string; base64: string };
  summary: PlaygroundSummary;
}
