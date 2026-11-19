import { RunInferenceHandler } from "./run-inference.handler.js";
import { RunMediaInferenceHandler } from "./run-media-inference.handler.js";
import { SubmitVideoJobHandler } from "./submit-video-job.handler.js";

export const CommandHandlers = [
  RunInferenceHandler,
  RunMediaInferenceHandler,
  SubmitVideoJobHandler,
];
