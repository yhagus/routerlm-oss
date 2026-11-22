import { dataUriOf, type MediaUpload } from "@/inference/models/media-upload.js";

// A multipart `/v1/images/edits` request, read into the JSON body the edits
// client contract parses, so that both forms are validated alike.

/** The file fields of an edit form: the OpenAI SDK names one image `image` and several `image[]`. */
export const IMAGE_EDIT_FILE_FIELDS = [
  { name: "image", maxCount: 1 },
  { name: "image[]" },
  { name: "mask", maxCount: 1 },
] as const satisfies readonly { name: string; maxCount?: number }[];

/** What multer read from the file fields; undefined for a JSON request. */
export type ImageEditFiles = Partial<
  Record<(typeof IMAGE_EDIT_FILE_FIELDS)[number]["name"], MediaUpload[]>
>;

/**
 * The edit request as JSON: the uploaded images become `images[].image_url`
 * data URIs, and an uploaded mask is kept so the contract can refuse it.
 * A JSON request has no files and passes through unchanged.
 */
export function imageEditBodyOf(body: unknown, files: ImageEditFiles | undefined): unknown {
  if (!files || Object.keys(files).length === 0) {
    return body;
  }
  const uploadedImages = [...(files.image ?? []), ...(files["image[]"] ?? [])];
  return {
    ...(typeof body === "object" && body),
    images: uploadedImages.map((file) => ({ image_url: dataUriOf(file) })),
    ...(files.mask && { mask: "(uploaded file)" }),
  };
}
