import { DownloadVideoContentHandler } from "./download-video-content.handler";
import { ListClientModelsHandler } from "./list-client-models.handler";
import { RetrieveVideoJobHandler } from "./retrieve-video-job.handler";

export const QueryHandlers = [
  ListClientModelsHandler,
  RetrieveVideoJobHandler,
  DownloadVideoContentHandler,
];
