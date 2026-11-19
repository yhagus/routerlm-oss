import { dataUriOf, type MediaUpload } from "../../models/media-upload.js";

// A multipart `/v1/audio/transcriptions` request, read into the body the
// transcription client contract parses.

/** The form field the OpenAI SDK uploads the audio in. */
export const TRANSCRIPTION_FILE_FIELD = "file";

/** The uploaded audio as the transcription client contract reads it. */
export interface TranscriptionFile {
  /** The content type the client gave the part. */
  contentType: string;
  fileName: string;
  dataUri: string;
}

/** The form's fields, with the uploaded audio as `file`; without an upload, `file` is left out. */
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
