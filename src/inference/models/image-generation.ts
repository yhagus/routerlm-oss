import type { FetchedMedia, MediaRequest } from "./media-kind.js";

// The image Kind's internal format (ADR 0002, once per Kind; ADR 0015).

/** An image size in pixels. */
export interface ImageSize {
  width: number;
  height: number;
}

/** An image request as the image Kind's upstream Protocols read it. */
export interface ImageGenerationRequest extends MediaRequest {
  prompt: string;
  /** How many images to generate. */
  n: number;
  /** Null lets the model choose. */
  size: ImageSize | null;
  negativePrompt: string | null;
  seed: number | null;
}

/** The generated images, fetched from where the upstream left them (ADR 0028). */
export interface GeneratedImages {
  images: FetchedMedia[];
}

/** How DashScope and the Upstream Model's `sizes` write a size: `1024*1024`. */
export function providerSizeOf({ width, height }: ImageSize): string {
  return `${width}*${height}`;
}

/** How OpenAI's Images API writes a size: `1024x1024`. */
export function clientSizeOf({ width, height }: ImageSize): string {
  return `${width}x${height}`;
}

/** Alibaba's image price tiers, by the most pixels an image of the tier has. */
const SIZE_TIERS = [
  { tier: "1K", maxPixels: 1024 * 1024 },
  { tier: "2K", maxPixels: 2048 * 2048 },
  { tier: "4K", maxPixels: 4096 * 4096 },
] as const;

/** The price tier of an image of this size: the smallest tier it fits in, by area. */
export function sizeTierOf({ width, height }: ImageSize): string {
  const pixels = width * height;
  const fitting = SIZE_TIERS.find(({ maxPixels }) => pixels <= maxPixels);
  return (fitting ?? SIZE_TIERS[SIZE_TIERS.length - 1]).tier;
}
