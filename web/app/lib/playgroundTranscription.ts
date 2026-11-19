// The Playground's transcription tab: the multipart form it sends and the
// transcript it gets back.

import {
  isPlaygroundSummary,
  type PlaygroundError,
  type PlaygroundSummary,
  readProperty,
} from "~/lib/playground";
import type { RouteSummary } from "~/lib/routing";

/** The gateway refuses larger uploads (413), as the backend's `MAX_UPLOAD_BYTES` says. */
export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

/** Why `file` can't be sent, or null when it can. Checked before uploading. */
export function audioFileProblemOf(file: File): string | null {
  if (file.size > MAX_AUDIO_BYTES) return "Audio files must be 25 MB or smaller.";
  return null;
}

export interface PlaygroundTranscriptionSettings {
  model: string;
  /** An ISO-639-1 code such as `en`; empty lets the model detect it. */
  language: string;
}

export type TranscriptionAnswerState =
  | { kind: "pending" }
  | { kind: "done"; text: string; summary: PlaygroundSummary }
  | { kind: "failed"; error: PlaygroundError }
  | { kind: "stopped" };

/** One request in the tab's history and what came back. */
export interface TranscriptionExchange {
  id: number;
  fileName: string;
  language: string;
  /** Sent straight to an Upstream Model, with no Model or Route. */
  isDirect: boolean;
  /** The Model's Routes when it was sent, for the receipt; null when direct or not loaded. */
  routes: RouteSummary[] | null;
  state: TranscriptionAnswerState;
}

/** The OpenAI transcription form for one request; `language` only when one is given. */
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

/** The Playground's answer `{text, summary}`, or null if it isn't one. */
export function transcriptionAnswerOf(
  payload: unknown,
): { text: string; summary: PlaygroundSummary } | null {
  const text = readProperty(payload, "text");
  const summary = readProperty(payload, "summary");
  if (typeof text !== "string" || !isPlaygroundSummary(summary)) return null;
  return { text, summary };
}
