import { z } from "zod";
import type { SnapshotUpstreamModel } from "@/snapshot/models/snapshot.js";
import { GatewayError } from "../../models/gateway-error.js";
import {
  clientSizeOf,
  type GeneratedImages,
  type ImageGenerationRequest,
  type ImageSize,
  providerSizeOf,
} from "../../models/image-generation.js";
import type { MediaClientContract, MediaResponseContext } from "../../models/media-kind.js";
import { dashScopeImageProtocol } from "../dashscope-image/dashscope-image-protocol.js";
import { openAiChatClientConverter } from "../openai-chat/openai-chat-client-converter.js";

// OpenAI's Images API, `POST /v1/images/generations` (ADR 0015).

/** The most images OpenAI's Images API lets one request ask for. */
const MAX_IMAGES_PER_REQUEST = 10;
/** DashScope's seed range. */
const MAX_SEED = 2_147_483_647;
const CLIENT_SIZE = /^(\d+)x(\d+)$/;
/** The `size` that leaves the choice to the model, as if none was sent. */
const AUTOMATIC_SIZE = "auto";

// A plain (non-strict) object: unknown fields are dropped (ADR 0002).
const requestSchema = z.object({
  model: z.string().min(1),
  prompt: z.string().min(1),
  n: z.int().min(1).max(MAX_IMAGES_PER_REQUEST).default(1),
  size: z.string().optional(),
  // Accepted extensions: DashScope takes both, OpenAI neither.
  negative_prompt: z.string().optional(),
  seed: z.int().min(0).max(MAX_SEED).optional(),
});

const featureRefusedSchema = z.object({
  response_format: z.unknown().optional(),
  stream: z.unknown().optional(),
  partial_images: z.unknown().optional(),
  mask: z.unknown().optional(),
});

function parseRequest(body: unknown): ImageGenerationRequest {
  refuseUnsupportedFeatures(body);
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    throw new GatewayError("invalid_request", `Invalid request: ${z.prettifyError(parsed.error)}`);
  }
  const { model, prompt, n, size, negative_prompt, seed } = parsed.data;
  return {
    model,
    prompt,
    n,
    size: size === undefined || size === AUTOMATIC_SIZE ? null : imageSizeOf(size),
    negativePrompt: negative_prompt ?? null,
    seed: seed ?? null,
  };
}

/** Images go back as `b64_json` only and never stream (ADR 0015); a mask is an edit (#67). */
function refuseUnsupportedFeatures(body: unknown): void {
  const features = featureRefusedSchema.safeParse(body);
  if (!features.success) {
    return; // Malformed: the full schema explains it.
  }
  const { response_format, stream, partial_images, mask } = features.data;
  if (response_format !== undefined && response_format !== "b64_json") {
    throw unsupported("`response_format` other than `b64_json`");
  }
  if (stream !== undefined && stream !== false) {
    throw unsupported("`stream`");
  }
  if (partial_images !== undefined && partial_images !== 0) {
    throw unsupported("`partial_images`");
  }
  if (mask !== undefined) {
    throw unsupported("`mask`");
  }
}

function imageSizeOf(size: string): ImageSize {
  const match = CLIENT_SIZE.exec(size);
  if (!match) {
    throw new GatewayError(
      "invalid_request",
      `Invalid request: the size "${size}" is not written as WIDTHxHEIGHT`,
    );
  }
  return { width: Number(match[1]), height: Number(match[2]) };
}

function unsupported(feature: string): GatewayError {
  return new GatewayError("invalid_request", `Not supported: ${feature}`);
}

function unservableReason(
  upstreamModel: SnapshotUpstreamModel,
  { size }: ImageGenerationRequest,
): string | null {
  if (size && upstreamModel.sizes && !upstreamModel.sizes.includes(providerSizeOf(size))) {
    return `the size ${clientSizeOf(size)}`;
  }
  return null;
}

function writeResponse({ images }: GeneratedImages, context: MediaResponseContext): unknown {
  return {
    created: Math.floor(context.createdAt.getTime() / 1000),
    data: images.map((image) => ({ b64_json: Buffer.from(image.bytes).toString("base64") })),
  };
}

export const openAiImagesClientContract: MediaClientContract<
  ImageGenerationRequest,
  GeneratedImages
> = {
  protocol: "openai-images",
  parseRequest,
  unservableReason,
  upstreamProtocols: { "dashscope-image": dashScopeImageProtocol },
  writeResponse,
  // The same envelope as Chat Completions: both are OpenAI's.
  writeError: (error) => openAiChatClientConverter.writeError(error),
};
