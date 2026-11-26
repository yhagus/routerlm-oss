import { dataUriOf, type MediaUpload } from '@/inference/models/media-upload';

export const IMAGE_EDIT_FILE_FIELDS = [
  { name: 'image', maxCount: 1 },
  { name: 'image[]' },
  { name: 'mask', maxCount: 1 },
] as const satisfies readonly { name: string; maxCount?: number }[];

export type ImageEditFiles = Partial<
  Record<(typeof IMAGE_EDIT_FILE_FIELDS)[number]['name'], MediaUpload[]>
>;

export function imageEditBodyOf(body: unknown, files: ImageEditFiles | undefined): unknown {
  if (!files || Object.keys(files).length === 0) {
    return body;
  }
  const uploadedImages = [...(files.image ?? []), ...(files['image[]'] ?? [])];
  return {
    ...(typeof body === 'object' && body),
    images: uploadedImages.map((file) => ({ image_url: dataUriOf(file) })),
    ...(files.mask && { mask: '(uploaded file)' }),
  };
}
