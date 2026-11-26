import { ProbeUpstreamModelHandler } from './probe-upstream-model.handler';
import { SendPlaygroundChatCompletionHandler } from './send-playground-chat-completion.handler';
import { SendPlaygroundImageGenerationHandler } from './send-playground-image-generation.handler';
import { SendPlaygroundVideoJobHandler } from './send-playground-video-job.handler';
import { SendPlaygroundSpeechHandler } from './send-playground-speech.handler';
import { SendPlaygroundTranscriptionHandler } from './send-playground-transcription.handler';

export const CommandHandlers = [
  SendPlaygroundChatCompletionHandler,
  SendPlaygroundImageGenerationHandler,
  SendPlaygroundVideoJobHandler,
  SendPlaygroundSpeechHandler,
  SendPlaygroundTranscriptionHandler,
  ProbeUpstreamModelHandler,
];
