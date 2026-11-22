import { z } from "zod";
import type { Transcript, TranscriptionRequest } from "@/inference/models/audio-transcription.js";
import type {
  MediaExchange,
  MediaOutcome,
  MediaUpstreamProtocol,
  MediaUpstreamTarget,
} from "@/inference/models/media-kind.js";
import { dashScopeFailureReasonOf } from "@/inference/protocols/dashscope/dashscope-errors.js";
import { UpstreamProtocolError } from "@/inference/protocols/upstream-protocol-converter.js";

// DashScope's native speech recognition API:
// one synchronous call with the audio inline as a data URI. The request and
// response shapes follow Alibaba's docs for the 3.1 models; see the Catalog
// notes of qwen-audio-3.0-asr-flash.

const GENERATION_PATH = "/services/aigc/multimodal-generation/generation";

const responseSchema = z.object({
  output: z.object({ text: z.string() }),
  /** `duration` is the audio's length in seconds, which DashScope bills. */
  usage: z.object({ duration: z.number().nonnegative() }),
});

/** The request body DashScope takes; `language_hints` is OpenAI's `language`. */
function requestBodyOf(request: TranscriptionRequest, upstreamModelId: string): unknown {
  return {
    model: upstreamModelId,
    input: {
      messages: [
        {
          role: "user",
          content: [{ type: "input_audio", input_audio: { data: request.audio.dataUri } }],
        },
      ],
    },
    parameters: {
      format: request.audio.format,
      ...(request.language !== null && { language_hints: [request.language] }),
    },
  };
}

async function generate(
  request: TranscriptionRequest,
  target: MediaUpstreamTarget,
  exchange: MediaExchange,
): Promise<MediaOutcome<Transcript>> {
  const answer = responseSchema.safeParse(
    await exchange.postJson(
      `${target.baseUrl}${GENERATION_PATH}`,
      requestBodyOf(request, target.upstreamModelId),
    ),
  );
  if (!answer.success) {
    throw new UpstreamProtocolError(
      `The upstream answered in a shape dashscope-transcription doesn't allow: ${z.prettifyError(answer.error)}`,
    );
  }
  const { output, usage } = answer.data;
  return {
    result: { text: output.text, seconds: usage.duration, responseFormat: request.responseFormat },
    units: { audioSeconds: usage.duration },
  };
}

export const dashScopeTranscriptionProtocol: MediaUpstreamProtocol<
  TranscriptionRequest,
  Transcript
> = {
  protocol: "dashscope-transcription",
  failureReasonOf: dashScopeFailureReasonOf,
  generate,
};
