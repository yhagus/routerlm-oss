import {
  isPlaygroundSummary,
  type PlaygroundError,
  type PlaygroundSummary,
  readProperty,
} from "~/lib/playground";
import type { RouteSummary } from "~/lib/routing";

export const AUTOMATIC_SIZE = "auto";
export const MAX_IMAGES_PER_REQUEST = 10;
export const MAX_SEED = 2_147_483_647;

export interface PlaygroundImageSettings {
  model: string;
  size?: string;
  count?: number;
  negativePrompt?: string;
  seed?: number;
}

export type ImageOperation = "generation" | "edit";

export type ImageAnswerState =
  | { kind: "pending" }
  | { kind: "done"; imageUrls: string[]; summary: PlaygroundSummary }
  | { kind: "failed"; error: PlaygroundError }
  | { kind: "stopped" };

export interface ImageExchange {
  id: number;
  prompt: string;
  inputImageUrls: string[];
  operation: ImageOperation;
  isDirect: boolean;
  routes: RouteSummary[] | null;
  state: ImageAnswerState;
}

export function imageRequestOf(
  settings: PlaygroundImageSettings,
  prompt: string,
  inputImageUrls: string[],
): { operation: ImageOperation; endpoint: string; body: Record<string, unknown> } {
  const body: Record<string, unknown> = {
    model: settings.model,
    prompt,
    n: settings.count,
    size: settings.size,
    negative_prompt: settings.negativePrompt,
    seed: settings.seed,
  };
  if (inputImageUrls.length === 0) {
    return { operation: "generation", endpoint: "images/generations", body };
  }
  return {
    operation: "edit",
    endpoint: "images/edits",
    body: { ...body, images: inputImageUrls.map((url) => ({ image_url: url })) },
  };
}

export function clientSizeOf(upstreamSize: string): string {
  return upstreamSize.replace("*", "x");
}

export function imageAnswerOf(
  payload: unknown,
): { imageUrls: string[]; summary: PlaygroundSummary } | null {
  const summary = readProperty(payload, "summary");
  const data = readProperty(readProperty(payload, "response"), "data");
  if (!isPlaygroundSummary(summary) || !Array.isArray(data)) return null;
  const imageUrls = data
    .map((image) => readProperty(image, "b64_json"))
    .filter((base64) => typeof base64 === "string")
    .map((base64) => `data:${imageMimeTypeOf(base64)};base64,${base64}`);
  return { imageUrls, summary };
}

const BASE64_SIGNATURES: [prefix: string, mimeType: string][] = [
  ["iVBOR", "image/png"],
  ["/9j/", "image/jpeg"],
  ["UklGR", "image/webp"],
];

function imageMimeTypeOf(base64: string): string {
  return BASE64_SIGNATURES.find(([prefix]) => base64.startsWith(prefix))?.[1] ?? "image/png";
}

const EXTENSIONS_BY_MIME_TYPE: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

export function imageFileName(exchangeId: number, index: number, dataUrl: string): string {
  const mimeType = dataUrl.slice("data:".length, dataUrl.indexOf(";"));
  return `image-${exchangeId}-${index + 1}.${EXTENSIONS_BY_MIME_TYPE[mimeType] ?? "png"}`;
}
