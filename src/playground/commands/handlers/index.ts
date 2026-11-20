import { ProbeUpstreamModelHandler } from "./probe-upstream-model.handler.js";
import { SendPlaygroundChatCompletionHandler } from "./send-playground-chat-completion.handler.js";
import { SendPlaygroundImageGenerationHandler } from "./send-playground-image-generation.handler.js";
import { SendPlaygroundVideoJobHandler } from "./send-playground-video-job.handler.js";
import { SendPlaygroundSpeechHandler } from "./send-playground-speech.handler.js";
import { SendPlaygroundTranscriptionHandler } from "./send-playground-transcription.handler.js";

export const CommandHandlers = [
  SendPlaygroundChatCompletionHandler,
  SendPlaygroundImageGenerationHandler,
  SendPlaygroundVideoJobHandler,
  SendPlaygroundSpeechHandler,
  SendPlaygroundTranscriptionHandler,
  ProbeUpstreamModelHandler,
];
