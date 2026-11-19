// The Playground's image tab: the OpenAI Images bodies it sends and the
// images it gets back.

import {
  isPlaygroundSummary,
  type PlaygroundError,
  type PlaygroundSummary,
  readProperty,
} from "~/lib/playground";
import type { RouteSummary } from "~/lib/routing";

/** The `size` that leaves the choice to the model; the tab doesn't send it. */
export const AUTOMATIC_SIZE = "auto";
/** The most images OpenAI's Images API lets one request ask for. */
export const MAX_IMAGES_PER_REQUEST = 10;
/** DashScope's seed range, the widest a Provider of ours takes. */
export const MAX_SEED = 2_147_483_647;

/** Parameters left undefined are not sent, so the model decides. */
export interface PlaygroundImageSettings {
  model: string;
  /** `WIDTHxHEIGHT`, as the Images API writes it. */
  size?: string;
  count?: number;
  negativePrompt?: string;
  seed?: number;
}

/** A prompt alone is a generation; a prompt with input images is an edit. */
export type ImageOperation = "generation" | "edit";

export type ImageAnswerState =
  | { kind: "pending" }
  | { kind: "done"; imageUrls: string[]; summary: PlaygroundSummary }
  | { kind: "failed"; error: PlaygroundError }
  | { kind: "stopped" };

/** One request in the tab's history and what came back. */
export interface ImageExchange {
  id: number;
  prompt: string;
  /** Data URLs of the attached images; empty for a generation. */
  inputImageUrls: string[];
  operation: ImageOperation;
  /** Sent straight to an Upstream Model, with no Model or Route. */
  isDirect: boolean;
  /** The Model's Routes when it was sent, for the receipt; null when direct or not loaded. */
  routes: RouteSummary[] | null;
  state: ImageAnswerState;
}

/** The Playground endpoint and OpenAI Images body for one request. */
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

/** The Images API's `WIDTHxHEIGHT` for a size an Upstream Model lists as `WIDTH*HEIGHT`. */
export function clientSizeOf(upstreamSize: string): string {
  return upstreamSize.replace("*", "x");
}

/** The Playground's answer `{response, summary}` as images to show, or null if it isn't one. */
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

/** Base64 starts of the formats image Providers answer in, by MIME type. */
const BASE64_SIGNATURES: [prefix: string, mimeType: string][] = [
  ["iVBOR", "image/png"],
  ["/9j/", "image/jpeg"],
  ["UklGR", "image/webp"],
];

/** The Images API sends bare base64, so the format is read from its first bytes. */
function imageMimeTypeOf(base64: string): string {
  return BASE64_SIGNATURES.find(([prefix]) => base64.startsWith(prefix))?.[1] ?? "image/png";
}

const EXTENSIONS_BY_MIME_TYPE: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

/** A download name for a returned image, such as `image-3-2.png`. */
export function imageFileName(exchangeId: number, index: number, dataUrl: string): string {
  const mimeType = dataUrl.slice("data:".length, dataUrl.indexOf(";"));
  return `image-${exchangeId}-${index + 1}.${EXTENSIONS_BY_MIME_TYPE[mimeType] ?? "png"}`;
}
