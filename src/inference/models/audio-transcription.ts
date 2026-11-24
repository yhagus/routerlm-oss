import type { MediaRequest } from "./media-kind.js";

export const AUDIO_FILE_FORMATS = [
  "aac",
  "amr",
  "flac",
  "m4a",
  "mp3",
  "mp4",
  "mpeg",
  "ogg",
  "opus",
  "wav",
  "webm",
] as const;
export type AudioFileFormat = (typeof AUDIO_FILE_FORMATS)[number];

export const TRANSCRIPT_FORMATS = ["json", "text"] as const;
export type TranscriptFormat = (typeof TRANSCRIPT_FORMATS)[number];

export interface TranscriptionRequest extends MediaRequest {
  audio: {
    dataUri: string;
    format: AudioFileFormat;
  };
  language: string | null;
  responseFormat: TranscriptFormat;
}

export interface Transcript {
  text: string;
  seconds: number;
  responseFormat: TranscriptFormat;
}
