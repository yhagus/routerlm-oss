import type { FetchedMedia, MediaRequest } from "./media-kind.js";

export interface ImageSize {
  width: number;
  height: number;
}

export interface ImageGenerationRequest extends MediaRequest {
  prompt: string;
  n: number;
  size: ImageSize | null;
  negativePrompt: string | null;
  seed: number | null;
  inputImages: string[];
}

export interface GeneratedImages {
  images: FetchedMedia[];
}

export function providerSizeOf({ width, height }: ImageSize): string {
  return `${width}*${height}`;
}

export function clientSizeOf({ width, height }: ImageSize): string {
  return `${width}x${height}`;
}

const SIZE_TIERS = [
  { tier: "1K", maxPixels: 1536 * 1536 },
  { tier: "2K", maxPixels: 2048 * 2048 },
] as const;
const LARGEST_TIER = "4K";

export function sizeTierOf({ width, height }: ImageSize): string {
  const pixels = width * height;
  const fitting = SIZE_TIERS.find(({ maxPixels }) => pixels <= maxPixels);
  return fitting?.tier ?? LARGEST_TIER;
}
