import { z } from "zod";
import {
  AUDIO_FILE_FORMATS,
  type AudioFileFormat,
  TRANSCRIPT_FORMATS,
  type Transcript,
  type TranscriptionRequest,
} from "@/inference/models/audio-transcription.js";
import { GatewayError } from "@/inference/models/gateway-error.js";
import {
  jsonReply,
  type MediaClientContract,
  type MediaReply,
} from "@/inference/models/media-kind.js";
import { dashScopeTranscriptionProtocol } from "@/inference/protocols/dashscope-transcription/dashscope-transcription-protocol.js";
import { writeOpenAiError } from "@/inference/protocols/openai-chat/openai-error.js";
import type { TranscriptionFile } from "./openai-transcription-form.js";

// OpenAI's transcription API, `POST /v1/audio/transcriptions`, a multipart
// upload.

const PLAIN_TEXT_CONTENT_TYPE = "text/plain; charset=utf-8";

/** The audio file format of each content type a client may give its upload. */
const FORMATS_BY_CONTENT_TYPE: Record<string, AudioFileFormat> = {
  "audio/aac": "aac",
  "audio/amr": "amr",
  "audio/flac": "flac",
  "audio/x-flac": "flac",
  "audio/m4a": "m4a",
  "audio/x-m4a": "m4a",
  "audio/mp4": "m4a",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/ogg": "ogg",
  "audio/opus": "opus",
  "audio/wav": "wav",
  "audio/wave": "wav",
  "audio/x-wav": "wav",
  "audio/webm": "webm",
  "video/mp4": "mp4",
  "video/mpeg": "mpeg",
  "video/webm": "webm",
};

const FILE_EXTENSION = /\.([a-z0-9]+)$/i;

const fileSchema = z.object({
  contentType: z.string(),
  fileName: z.string(),
  dataUri: z.string(),
}) satisfies z.ZodType<TranscriptionFile>;

// A plain (non-strict) object: unknown fields, such as `prompt`, are dropped (ADR 0002).
const requestSchema = z.object({
  model: z.string().min(1),
  file: fileSchema,
  language: z.string().min(1).optional(),
  response_format: z.enum(TRANSCRIPT_FORMATS).default("json"),
});

const featureRefusedSchema = z.object({
  response_format: z.unknown().optional(),
  stream: z.unknown().optional(),
});

function parseRequest(body: unknown): TranscriptionRequest {
  refuseUnsupportedFeatures(body);
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    throw new GatewayError(
      "invalid_request",
      `Invalid request: ${z.prettifyError(parsed.error)}`,
      "client",
    );
  }
  const { model, file, language, response_format } = parsed.data;
  return {
    model,
    audio: { dataUri: file.dataUri, format: audioFileFormatOf(file) },
    language: language ?? null,
    responseFormat: response_format,
  };
}

/** Subtitle and verbose formats need timestamps no upstream returns yet, and transcripts don't stream yet. */
function refuseUnsupportedFeatures(body: unknown): void {
  const features = featureRefusedSchema.safeParse(body);
  if (!features.success) {
    return; // Malformed: the full schema explains it.
  }
  const { response_format, stream } = features.data;
  if (typeof response_format === "string" && !isTranscriptFormat(response_format)) {
    throw unsupported(`the response_format "${response_format}"`);
  }
  // A form field arrives as the string "true".
  if (stream === true || stream === "true") {
    throw unsupported("`stream`");
  }
}

function isTranscriptFormat(format: string): boolean {
  return TRANSCRIPT_FORMATS.some((known) => known === format);
}

/**
 * The upload's format, from its content type, or from its file name when the
 * client sent a generic type such as `application/octet-stream`.
 */
function audioFileFormatOf({ contentType, fileName }: TranscriptionFile): AudioFileFormat {
  const byContentType = FORMATS_BY_CONTENT_TYPE[contentType.toLowerCase()];
  if (byContentType) {
    return byContentType;
  }
  const extension = FILE_EXTENSION.exec(fileName)?.[1]?.toLowerCase();
  const byExtension = AUDIO_FILE_FORMATS.find((format) => format === extension);
  if (byExtension) {
    return byExtension;
  }
  throw unsupported(`an uploaded file of type "${contentType}"`);
}

function unsupported(feature: string): GatewayError {
  return new GatewayError("invalid_request", `Not supported: ${feature}`, "client");
}

function writeResponse({ text, seconds, responseFormat }: Transcript): MediaReply {
  if (responseFormat === "text") {
    return { contentType: PLAIN_TEXT_CONTENT_TYPE, body: new TextEncoder().encode(text) };
  }
  return jsonReply({ text, usage: { type: "duration", seconds } });
}

export const openAiTranscriptionClientContract: MediaClientContract<
  TranscriptionRequest,
  Transcript
> = {
  protocol: "openai-transcription",
  parseRequest,
  // A transcription Upstream Model has no limit the gateway checks before sending.
  unservableReason: () => null,
  upstreamProtocols: { "dashscope-transcription": dashScopeTranscriptionProtocol },
  writeResponse,
  writeError: writeOpenAiError,
};
