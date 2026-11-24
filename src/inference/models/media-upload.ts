import type { MulterModuleOptions } from "@nestjs/platform-node";

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export const MEDIA_UPLOAD_OPTIONS = {
  limits: { fileSize: MAX_UPLOAD_BYTES },
} satisfies MulterModuleOptions;

export interface MediaUpload {
  mimetype: string;
  originalname: string;
  buffer: Buffer;
}

export function dataUriOf({ mimetype, buffer }: MediaUpload): string {
  return `data:${mimetype};base64,${buffer.toString("base64")}`;
}
