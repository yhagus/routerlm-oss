import type { FetchedMedia, MediaRequest } from "./media-kind.js";

// The speech Kind's internal format (ADR 0002, once per Kind).

/** The audio formats every speech upstream Protocol can produce; another is refused, never converted. */
export const AUDIO_FORMATS = ["mp3", "wav", "pcm", "opus"] as const;
export type AudioFormat = (typeof AUDIO_FORMATS)[number];

/** A speech request as the speech Kind's upstream Protocols read it. */
export interface SpeechSynthesisRequest extends MediaRequest {
  /** The text to speak. */
  text: string;
  /** The Provider's own voice name, passed through unchanged. */
  voice: string;
  format: AudioFormat;
  /** The speaking rate, 1 being normal; null leaves the Provider's default. */
  speed: number | null;
}

/** The synthesized audio, fetched from where the upstream left it (ADR 0028). */
export interface SynthesizedSpeech {
  audio: FetchedMedia;
  format: AudioFormat;
}
