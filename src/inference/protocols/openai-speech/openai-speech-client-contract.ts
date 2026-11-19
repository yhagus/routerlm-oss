import { z } from "zod";
import type { ParameterPolicy } from "@/db/schemas/index.js";
import { GatewayError } from "../../models/gateway-error.js";
import type { MediaClientContract, MediaReply } from "../../models/media-kind.js";
import {
  AUDIO_FORMATS,
  type AudioFormat,
  type SpeechSynthesisRequest,
  type SynthesizedSpeech,
} from "../../models/speech-synthesis.js";
import { dashScopeSpeechProtocol } from "../dashscope-speech/dashscope-speech-protocol.js";
import { openAiChatClientConverter } from "../openai-chat/openai-chat-client-converter.js";

// OpenAI's speech API, `POST /v1/audio/speech` (spec "Phase 2: speech").

/** OpenAI's range for `speed`; the upstream refuses what its model doesn't take. */
const MIN_SPEED = 0.25;
const MAX_SPEED = 4;
/** What OpenAI answers when the client names no format. */
const DEFAULT_FORMAT: AudioFormat = "mp3";

/** The content type the client gets for each format, whatever type the Provider's host served. */
const CONTENT_TYPES = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  pcm: "audio/pcm",
  opus: "audio/opus",
} as const satisfies Record<AudioFormat, string>;

// A plain (non-strict) object: unknown fields are dropped (ADR 0002). That
// includes `instructions`, accepted but not sent: nobody has confirmed that
// qwen-audio-3.0-tts-plus honours DashScope's `instruction` (see its Catalog notes).
const requestSchema = z.object({
  model: z.string().min(1),
  input: z.string().min(1),
  voice: z.string().min(1),
  response_format: z.enum(AUDIO_FORMATS).default(DEFAULT_FORMAT),
  speed: z.number().min(MIN_SPEED).max(MAX_SPEED).optional(),
});

const featureRefusedSchema = z.object({
  response_format: z.unknown().optional(),
  stream_format: z.unknown().optional(),
});

function parseRequest(body: unknown): SpeechSynthesisRequest {
  refuseUnsupportedFeatures(body);
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    throw new GatewayError("invalid_request", `Invalid request: ${z.prettifyError(parsed.error)}`);
  }
  const { model, input, voice, response_format, speed } = parsed.data;
  return { model, text: input, voice, format: response_format, speed: speed ?? null };
}

/**
 * A format the Provider can't produce is refused rather than converted, and
 * speech doesn't stream yet.
 */
function refuseUnsupportedFeatures(body: unknown): void {
  const features = featureRefusedSchema.safeParse(body);
  if (!features.success) {
    return; // Malformed: the full schema explains it.
  }
  const { response_format, stream_format } = features.data;
  if (typeof response_format === "string" && !isAudioFormat(response_format)) {
    throw unsupported(`the response_format "${response_format}"`);
  }
  if (stream_format !== undefined && stream_format !== "audio") {
    throw unsupported("`stream_format` other than `audio`");
  }
}

function isAudioFormat(format: string): format is AudioFormat {
  return AUDIO_FORMATS.some((known) => known === format);
}

function unsupported(feature: string): GatewayError {
  return new GatewayError("invalid_request", `Not supported: ${feature}`);
}

/** A forced voice replaces the client's; the client always names one, so a default never applies. */
function applyParameterPolicy(
  request: SpeechSynthesisRequest,
  policy: ParameterPolicy,
): SpeechSynthesisRequest {
  const forcedVoice = policy.forced?.voice;
  return forcedVoice === undefined ? request : { ...request, voice: forcedVoice };
}

function writeResponse({ audio, format }: SynthesizedSpeech): MediaReply {
  return { contentType: CONTENT_TYPES[format], body: audio.bytes };
}

export const openAiSpeechClientContract: MediaClientContract<
  SpeechSynthesisRequest,
  SynthesizedSpeech
> = {
  protocol: "openai-speech",
  parseRequest,
  // A speech Upstream Model has no limit the gateway checks before sending.
  unservableReason: () => null,
  upstreamProtocols: { "dashscope-speech": dashScopeSpeechProtocol },
  applyParameterPolicy,
  writeResponse,
  // The same envelope as Chat Completions: both are OpenAI's.
  writeError: (error) => openAiChatClientConverter.writeError(error),
};
