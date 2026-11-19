import type { MediaRequest } from "./media-kind.js";

// The transcription Kind's internal format (ADR 0002, once per Kind).

/** The audio file formats a transcription upstream Protocol is sent, named as DashScope names them. */
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

/** How the client gets the transcript: OpenAI's JSON object, or the text alone. */
export const TRANSCRIPT_FORMATS = ["json", "text"] as const;
export type TranscriptFormat = (typeof TRANSCRIPT_FORMATS)[number];

/** A transcription request as the transcription Kind's upstream Protocols read it. */
export interface TranscriptionRequest extends MediaRequest {
  audio: {
    /** The uploaded file inline, as `data:<type>;base64,...`. */
    dataUri: string;
    format: AudioFileFormat;
  };
  /** The language the client says the audio is in, as a hint; null leaves detection to the Provider. */
  language: string | null;
  responseFormat: TranscriptFormat;
}

/** What the upstream heard, and how long the audio it billed was. */
export interface Transcript {
  text: string;
  seconds: number;
  responseFormat: TranscriptFormat;
}
