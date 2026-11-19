import { SendPlaygroundChatCompletionHandler } from "./send-playground-chat-completion.handler.js";
import { SendPlaygroundImageGenerationHandler } from "./send-playground-image-generation.handler.js";
import { SendPlaygroundSpeechHandler } from "./send-playground-speech.handler.js";
import { SendPlaygroundTranscriptionHandler } from "./send-playground-transcription.handler.js";

export const CommandHandlers = [
  SendPlaygroundChatCompletionHandler,
  SendPlaygroundImageGenerationHandler,
  SendPlaygroundSpeechHandler,
  SendPlaygroundTranscriptionHandler,
];
