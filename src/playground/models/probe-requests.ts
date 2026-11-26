import { RunInferenceCommand } from "@/inference/commands/impl/run-inference.command";
import { RunMediaInferenceCommand } from "@/inference/commands/impl/run-media-inference.command";
import type { InferenceCaller, ProbeTarget, UsageListener } from "@/inference/models/inference";
import type { ReasoningEffort } from "@/inference/models/internal-format";
import { openAiChatClientConverter } from "@/inference/protocols/openai-chat/openai-chat-client-converter";
import { openAiImagesClientContract } from "@/inference/protocols/openai-images/openai-images-client-contract";
import { openAiSpeechClientContract } from "@/inference/protocols/openai-speech/openai-speech-client-contract";
import { openAiTranscriptionClientContract } from "@/inference/protocols/openai-transcription/openai-transcription-client-contract";
import type { ClientConnection } from "@/libs/models/client-connection";
import type { SnapshotUpstreamModel } from "@/snapshot/models/snapshot";
import {
  PROBE_AUDIO_CONTENT_TYPE,
  PROBE_AUDIO_DATA_URI,
  PROBE_AUDIO_FILE_NAME,
} from "@/playground/data/probe-audio";
import type { ProbedKind } from "./probe-plan";

const CHAT_PROMPT = "Reply with the word OK.";
const CHAT_MAX_TOKENS = 16;
const CHAT_REASONING_EFFORT: ReasoningEffort = "low";
const IMAGE_PROMPT = "A plain white square.";
const SPEECH_TEXT = "OK.";
const SPEECH_VOICE = "Cherry";
const PROVIDER_SIZE = /^(\d+)\*(\d+)$/;

export interface ProbeCall {
  upstreamModel: SnapshotUpstreamModel;
  target: ProbeTarget;
  caller: InferenceCaller;
  connection: ClientConnection;
  onUsage: UsageListener;
}

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

function reasoningFor({ capabilities }: SnapshotUpstreamModel): {
  reasoning_effort?: ReasoningEffort;
} {
  return capabilities.includes("reasoning") ? { reasoning_effort: CHAT_REASONING_EFFORT } : {};
}

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
