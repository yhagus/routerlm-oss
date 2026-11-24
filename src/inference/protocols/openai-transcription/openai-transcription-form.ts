import { dataUriOf, type MediaUpload } from "@/inference/models/media-upload.js";

export const TRANSCRIPTION_FILE_FIELD = "file";

export interface TranscriptionFile {
  contentType: string;
  fileName: string;
  dataUri: string;
}

export function transcriptionBodyOf(body: unknown, file: MediaUpload | undefined): unknown {
  if (!file) {
    return body;
  }
  const transcriptionFile: TranscriptionFile = {
    contentType: file.mimetype,
    fileName: file.originalname,
    dataUri: dataUriOf(file),
  };
  return { ...(typeof body === "object" && body), file: transcriptionFile };
}
