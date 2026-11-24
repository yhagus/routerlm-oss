import {
  isPlaygroundSummary,
  type PlaygroundError,
  type PlaygroundSummary,
  readProperty,
} from "~/lib/playground";
import type { RouteSummary } from "~/lib/routing";

/** The gateway refuses larger uploads (413), as the backend's `MAX_UPLOAD_BYTES` says. */
export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

export function audioFileProblemOf(file: File): string | null {
  if (file.size > MAX_AUDIO_BYTES) return "Audio files must be 25 MB or smaller.";
  return null;
}

export interface PlaygroundTranscriptionSettings {
  model: string;
  language: string;
}

export type TranscriptionAnswerState =
  | { kind: "pending" }
  | { kind: "done"; text: string; summary: PlaygroundSummary }
  | { kind: "failed"; error: PlaygroundError }
  | { kind: "stopped" };

export interface TranscriptionExchange {
  id: number;
  fileName: string;
  language: string;
  isDirect: boolean;
  routes: RouteSummary[] | null;
  state: TranscriptionAnswerState;
}

export function transcriptionFormOf(
  settings: PlaygroundTranscriptionSettings,
  file: File,
): FormData {
  const form = new FormData();
  form.append("model", settings.model);
  form.append("file", file);
  if (settings.language !== "") form.append("language", settings.language);
  return form;
}

export function transcriptionAnswerOf(
  payload: unknown,
): { text: string; summary: PlaygroundSummary } | null {
  const text = readProperty(payload, "text");
  const summary = readProperty(payload, "summary");
  if (typeof text !== "string" || !isPlaygroundSummary(summary)) return null;
  return { text, summary };
}
