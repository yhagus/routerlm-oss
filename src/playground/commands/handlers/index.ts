import { SendPlaygroundChatCompletionHandler } from "./send-playground-chat-completion.handler.js";
import { SendPlaygroundImageGenerationHandler } from "./send-playground-image-generation.handler.js";
import { SendPlaygroundVideoJobHandler } from "./send-playground-video-job.handler.js";

export const CommandHandlers = [
  SendPlaygroundChatCompletionHandler,
  SendPlaygroundImageGenerationHandler,
  SendPlaygroundVideoJobHandler,
];
