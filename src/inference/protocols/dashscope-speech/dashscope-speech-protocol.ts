import { z } from "zod";
import type {
  MediaExchange,
  MediaOutcome,
  MediaUpstreamProtocol,
  MediaUpstreamTarget,
} from "@/inference/models/media-kind.js";
import type {
  SpeechSynthesisRequest,
  SynthesizedSpeech,
} from "@/inference/models/speech-synthesis.js";
import { dashScopeFailureReasonOf } from "@/inference/protocols/dashscope/dashscope-errors.js";
import { UpstreamProtocolError } from "@/inference/protocols/upstream-protocol-converter.js";

// DashScope's native speech synthesis API: one
// synchronous call that answers with the URL of the audio, which the gateway
// fetches.

const SYNTHESIZER_PATH = "/services/audio/tts/SpeechSynthesizer";

const responseSchema = z.object({
  output: z.object({ audio: z.object({ url: z.string().min(1) }) }),
  usage: z.object({ characters: z.int().nonnegative() }),
});

/** The request body DashScope takes; `rate` is OpenAI's `speed`. */
function requestBodyOf(request: SpeechSynthesisRequest, upstreamModelId: string): unknown {
  return {
    model: upstreamModelId,
    input: {
      text: request.text,
      voice: request.voice,
      format: request.format,
      ...(request.speed !== null && { rate: request.speed }),
    },
  };
}

async function generate(
  request: SpeechSynthesisRequest,
  target: MediaUpstreamTarget,
  exchange: MediaExchange,
): Promise<MediaOutcome<SynthesizedSpeech>> {
  const answer = responseSchema.safeParse(
    await exchange.postJson(
      `${target.baseUrl}${SYNTHESIZER_PATH}`,
      requestBodyOf(request, target.upstreamModelId),
    ),
  );
  if (!answer.success) {
    throw new UpstreamProtocolError(
      `The upstream answered in a shape dashscope-speech doesn't allow: ${z.prettifyError(answer.error)}`,
    );
  }
  const audio = await exchange.fetchMedia(answer.data.output.audio.url);
  return {
    result: { audio, format: request.format },
    units: { characters: answer.data.usage.characters },
  };
}

export const dashScopeSpeechProtocol: MediaUpstreamProtocol<
  SpeechSynthesisRequest,
  SynthesizedSpeech
> = {
  protocol: "dashscope-speech",
  failureReasonOf: dashScopeFailureReasonOf,
  generate,
};
