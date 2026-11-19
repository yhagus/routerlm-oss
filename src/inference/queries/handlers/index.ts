import { DownloadVideoContentHandler } from "./download-video-content.handler.js";
import { ListClientModelsHandler } from "./list-client-models.handler.js";
import { RetrieveVideoJobHandler } from "./retrieve-video-job.handler.js";

export const QueryHandlers = [
  ListClientModelsHandler,
  RetrieveVideoJobHandler,
  DownloadVideoContentHandler,
];
