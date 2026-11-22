import { RunInferenceCommand } from "@/inference/commands/impl/run-inference.command.js";
import { RunMediaInferenceCommand } from "@/inference/commands/impl/run-media-inference.command.js";
import type { InferenceCaller, ProbeTarget, UsageListener } from "@/inference/models/inference.js";
import type { ReasoningEffort } from "@/inference/models/internal-format.js";
import { openAiChatClientConverter } from "@/inference/protocols/openai-chat/openai-chat-client-converter.js";
import { openAiImagesClientContract } from "@/inference/protocols/openai-images/openai-images-client-contract.js";
import { openAiSpeechClientContract } from "@/inference/protocols/openai-speech/openai-speech-client-contract.js";
import { openAiTranscriptionClientContract } from "@/inference/protocols/openai-transcription/openai-transcription-client-contract.js";
import type { ClientConnection } from "@/libs/models/client-connection.js";
import type { SnapshotUpstreamModel } from "@/snapshot/models/snapshot.js";
import {
  PROBE_AUDIO_CONTENT_TYPE,
  PROBE_AUDIO_DATA_URI,
  PROBE_AUDIO_FILE_NAME,
} from "@/playground/data/probe-audio.js";
import type { ProbedKind } from "./probe-plan.js";

// The fixed, minimal request a Probe sends for each Model Kind (GLOSSARY
// "Probe"), written as a client would send it, so it goes upstream through the
// same parsing and Protocol conversion as any other request.

const CHAT_PROMPT = "Reply with the word OK.";
/** Enough for a short answer; a reasoning model may spend them all and answer empty, which still counts. */
const CHAT_MAX_TOKENS = 16;
/**
 * The lowest effort every reasoning Upstream Model accepts: some refuse
 * `none`, others `minimal` too (see the Catalog notes). A Provider that takes
 * reasoning as a `thinking` object gets its own name for it from its quirk.
 */
const CHAT_REASONING_EFFORT: ReasoningEffort = "low";
const IMAGE_PROMPT = "A plain white square.";
const SPEECH_TEXT = "OK.";
/**
 * DashScope's default Qwen-TTS voice. Speech goes out only over
 * dashscope-speech, and an Upstream Model lists no voices to take the first of.
 */
const SPEECH_VOICE = "Cherry";
/** How an Upstream Model's sizes are written: `1024*1024`. */
const PROVIDER_SIZE = /^(\d+)\*(\d+)$/;

/** What one Probe call needs besides its fixed request. */
export interface ProbeCall {
  upstreamModel: SnapshotUpstreamModel;
  target: ProbeTarget;
  caller: InferenceCaller;
  connection: ClientConnection;
  onUsage: UsageListener;
}

/** The inference command that sends the Kind's fixed request as one Probe call. */
export function probeCommandFor(
  kind: ProbedKind,
  { upstreamModel, target, caller, connection, onUsage }: ProbeCall,
): RunInferenceCommand | RunMediaInferenceCommand {
  const model = upstreamModel.upstreamModelId;
  switch (kind) {
    case "chat":
      return new RunInferenceCommand(
        openAiChatClientConverter,
        {
          model,
          messages: [{ role: "user", content: CHAT_PROMPT }],
          max_tokens: CHAT_MAX_TOKENS,
          stream: false,
          ...reasoningFor(upstreamModel),
        },
        caller,
        connection,
        onUsage,
        target,
      );
    case "image":
      return new RunMediaInferenceCommand(
        openAiImagesClientContract,
        { model, prompt: IMAGE_PROMPT, n: 1, ...smallestSizeOf(upstreamModel) },
        caller,
        connection,
        onUsage,
        target,
      );
    case "speech":
      return new RunMediaInferenceCommand(
        openAiSpeechClientContract,
        { model, input: SPEECH_TEXT, voice: SPEECH_VOICE },
        caller,
        connection,
        onUsage,
        target,
      );
    case "transcription":
      return new RunMediaInferenceCommand(
        openAiTranscriptionClientContract,
        {
          model,
          file: {
            contentType: PROBE_AUDIO_CONTENT_TYPE,
            fileName: PROBE_AUDIO_FILE_NAME,
            dataUri: PROBE_AUDIO_DATA_URI,
          },
        },
        caller,
        connection,
        onUsage,
        target,
      );
  }
}

/** The lowest reasoning effort for a reasoning Upstream Model; none asked of another. */
function reasoningFor({ capabilities }: SnapshotUpstreamModel): {
  reasoning_effort?: ReasoningEffort;
} {
  return capabilities.includes("reasoning") ? { reasoning_effort: CHAT_REASONING_EFFORT } : {};
}

/**
 * The smallest of the Upstream Model's sizes, by pixels, as a client writes
 * it (`512x512`); no size, so the Provider's default, when it lists none.
 */
function smallestSizeOf({ sizes }: SnapshotUpstreamModel): { size?: string } {
  const dimensions = (sizes ?? []).flatMap((size) => {
    const match = PROVIDER_SIZE.exec(size);
    return match ? [{ width: Number(match[1]), height: Number(match[2]) }] : [];
  });
  const [smallest] = dimensions.sort(
    (first, second) => first.width * first.height - second.width * second.height,
  );
  return smallest ? { size: `${smallest.width}x${smallest.height}` } : {};
}
