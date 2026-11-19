import { dataUriOf, type MediaUpload } from "../../models/media-upload.js";

// A multipart `/v1/videos` request, as the OpenAI SDK sends one with a first
// frame, read into the JSON body the videos client contract parses.

/** The file field of OpenAI's first frame. */
export const VIDEO_FIRST_FRAME_FIELD = "input_reference";

/**
 * The video request as JSON: an uploaded first frame becomes an
 * `input_reference.image_url` data URI. A request without a file passes
 * through unchanged.
 */
export function videoBodyOf(body: unknown, firstFrame: MediaUpload | undefined): unknown {
  if (!firstFrame) {
    return body;
  }
  return {
    ...(typeof body === "object" && body),
    input_reference: { image_url: dataUriOf(firstFrame) },
  };
}
