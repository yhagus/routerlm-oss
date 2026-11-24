import { z } from "zod";
import type { ParameterPolicy } from "@/db/schemas/index.js";
import { GatewayError } from "@/inference/models/gateway-error.js";
import type { MediaClientContract, MediaReply } from "@/inference/models/media-kind.js";
import {
  AUDIO_FORMATS,
  type AudioFormat,
  type SpeechSynthesisRequest,
  type SynthesizedSpeech,
} from "@/inference/models/speech-synthesis.js";
import { dashScopeSpeechProtocol } from "@/inference/protocols/dashscope-speech/dashscope-speech-protocol.js";
import { writeOpenAiError } from "@/inference/protocols/openai-chat/openai-error.js";

const MIN_SPEED = 0.25;
const MAX_SPEED = 4;
const DEFAULT_FORMAT: AudioFormat = "mp3";

const CONTENT_TYPES = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  pcm: "audio/pcm",
  opus: "audio/opus",
} as const satisfies Record<AudioFormat, string>;

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
    throw new GatewayError(
      "invalid_request",
      `Invalid request: ${z.prettifyError(parsed.error)}`,
      "client",
    );
  }
  const { model, input, voice, response_format, speed } = parsed.data;
  return { model, text: input, voice, format: response_format, speed: speed ?? null };
}

function refuseUnsupportedFeatures(body: unknown): void {
  const features = featureRefusedSchema.safeParse(body);
  if (!features.success) {
    return;
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
  return new GatewayError("invalid_request", `Not supported: ${feature}`, "client");
}

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
  unservableReason: () => null,
  upstreamProtocols: { "dashscope-speech": dashScopeSpeechProtocol },
  applyParameterPolicy,
  writeResponse,
  writeError: writeOpenAiError,
};
