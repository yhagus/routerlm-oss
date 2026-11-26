import { RunInferenceHandler } from './run-inference.handler';
import { RunMediaInferenceHandler } from './run-media-inference.handler';
import { SubmitVideoJobHandler } from './submit-video-job.handler';

export const CommandHandlers = [
  RunInferenceHandler,
  RunMediaInferenceHandler,
  SubmitVideoJobHandler,
];
