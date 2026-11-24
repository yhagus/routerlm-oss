import { dataUriOf, type MediaUpload } from "@/inference/models/media-upload.js";

export const VIDEO_FIRST_FRAME_FIELD = "input_reference";

export function videoBodyOf(body: unknown, firstFrame: MediaUpload | undefined): unknown {
  if (!firstFrame) {
    return body;
  }
  return {
    ...(typeof body === "object" && body),
    input_reference: { image_url: dataUriOf(firstFrame) },
  };
}
