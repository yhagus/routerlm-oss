import type { MulterModuleOptions } from "@nestjs/platform-node";

// Multipart uploads to media endpoints (spec "Implementation Decisions":
// `@nestjs/platform-node`'s multer integration). multer keeps each file in
// memory, never on disk (ADR 0004).

/** The largest file a client may upload (spec user story 35); a larger one gets a 413. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/** The multer options every media upload route uses. */
export const MEDIA_UPLOAD_OPTIONS = {
  limits: { fileSize: MAX_UPLOAD_BYTES },
} satisfies MulterModuleOptions;

/** A file a client uploaded, as multer's memory storage holds it. */
export interface MediaUpload {
  /** The content type the client gave the part. */
  mimetype: string;
  /** The file name the client gave the part. */
  originalname: string;
  buffer: Buffer;
}

/** The file as a data URI, how an upstream takes inline media. */
export function dataUriOf({ mimetype, buffer }: MediaUpload): string {
  return `data:${mimetype};base64,${buffer.toString("base64")}`;
}
