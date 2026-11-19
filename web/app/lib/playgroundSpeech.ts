// The Playground's speech tab: the OpenAI speech body it sends and the audio
// it gets back.

import {
  isPlaygroundSummary,
  type PlaygroundError,
  type PlaygroundSummary,
  readProperty,
} from "~/lib/playground";
import type { RouteSummary } from "~/lib/routing";

/** The formats the gateway's speech endpoint takes, as the backend's `AUDIO_FORMATS` says. */
export const AUDIO_FORMATS = ["mp3", "wav", "pcm", "opus"] as const;
export type AudioFormat = (typeof AUDIO_FORMATS)[number];

/** What OpenAI's speech API answers in when no format is named. */
export const DEFAULT_AUDIO_FORMAT: AudioFormat = "mp3";

export const AUDIO_FORMAT_LABELS: Record<AudioFormat, string> = {
  mp3: "MP3",
  wav: "WAV",
  pcm: "PCM (download only)",
  opus: "Opus",
};

/** Raw PCM has no header, so a browser can't play it; it can only be downloaded. */
export function isPlayableFormat(format: AudioFormat): boolean {
  return format !== "pcm";
}

export interface PlaygroundSpeechSettings {
  model: string;
  /** The Provider's own voice name, sent unchanged. */
  voice: string;
  format: AudioFormat;
}

export type SpeechAnswerState =
  | { kind: "pending" }
  | { kind: "done"; audioUrl: string; summary: PlaygroundSummary }
  | { kind: "failed"; error: PlaygroundError }
  | { kind: "stopped" };

/** One request in the tab's history and what came back. */
export interface SpeechExchange {
  id: number;
  text: string;
  voice: string;
  format: AudioFormat;
  /** Sent straight to an Upstream Model, with no Model or Route. */
  isDirect: boolean;
  /** The Model's Routes when it was sent, for the receipt; null when direct or not loaded. */
  routes: RouteSummary[] | null;
  state: SpeechAnswerState;
}

/** The OpenAI speech body for one request. */
export function speechRequestOf(
  settings: PlaygroundSpeechSettings,
  text: string,
): Record<string, unknown> {
  return {
    model: settings.model,
    input: text,
    voice: settings.voice,
    response_format: settings.format,
  };
}

/** The Playground's answer `{audio, summary}` as audio to play, or null if it isn't one. */
export function speechAnswerOf(
  payload: unknown,
): { audioUrl: string; summary: PlaygroundSummary } | null {
  const summary = readProperty(payload, "summary");
  const audio = readProperty(payload, "audio");
  const contentType = readProperty(audio, "contentType");
  const base64 = readProperty(audio, "base64");
  if (!isPlaygroundSummary(summary) || typeof contentType !== "string") return null;
  if (typeof base64 !== "string") return null;
  return { audioUrl: `data:${contentType};base64,${base64}`, summary };
}

/** A download name for returned audio, such as `speech-3.mp3`. */
export function speechFileName(exchangeId: number, format: AudioFormat): string {
  return `speech-${exchangeId}.${format}`;
}
