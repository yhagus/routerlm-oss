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

export const DEFAULT_AUDIO_FORMAT: AudioFormat = "mp3";

export const AUDIO_FORMAT_LABELS: Record<AudioFormat, string> = {
  mp3: "MP3",
  wav: "WAV",
  pcm: "PCM (download only)",
  opus: "Opus",
};

export function isPlayableFormat(format: AudioFormat): boolean {
  return format !== "pcm";
}

export interface PlaygroundSpeechSettings {
  model: string;
  voice: string;
  format: AudioFormat;
}

export type SpeechAnswerState =
  | { kind: "pending" }
  | { kind: "done"; audioUrl: string; summary: PlaygroundSummary }
  | { kind: "failed"; error: PlaygroundError }
  | { kind: "stopped" };

export interface SpeechExchange {
  id: number;
  text: string;
  voice: string;
  format: AudioFormat;
  isDirect: boolean;
  routes: RouteSummary[] | null;
  state: SpeechAnswerState;
}

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

export function speechFileName(exchangeId: number, format: AudioFormat): string {
  return `speech-${exchangeId}.${format}`;
}
