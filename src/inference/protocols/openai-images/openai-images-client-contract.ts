import { z } from "zod";
import type { SnapshotUpstreamModel } from "@/snapshot/models/snapshot.js";
import { GatewayError } from "@/inference/models/gateway-error.js";
import {
  clientSizeOf,
  type GeneratedImages,
  type ImageGenerationRequest,
  type ImageSize,
  providerSizeOf,
} from "@/inference/models/image-generation.js";
import {
  jsonReply,
  type MediaClientContract,
  type MediaReply,
  type MediaResponseContext,
} from "@/inference/models/media-kind.js";
import { dashScopeImageProtocol } from "@/inference/protocols/dashscope-image/dashscope-image-protocol.js";
import { writeOpenAiError } from "@/inference/protocols/openai-chat/openai-error.js";

const MAX_IMAGES_PER_REQUEST = 10;
export const MAX_INPUT_IMAGES_PER_EDIT = 16;
const MAX_SEED = 2_147_483_647;
const CLIENT_SIZE = /^(\d+)x(\d+)$/;
const AUTOMATIC_SIZE = "auto";
const FORM_INTEGER = /^\d+$/;

function integerField(schema: z.ZodInt) {
  return z.preprocess(
    (value) => (typeof value === "string" && FORM_INTEGER.test(value) ? Number(value) : value),
    schema,
  );
}

const generationSchema = z.object({
  model: z.string().min(1),
  prompt: z.string().min(1),
  n: z.int().min(1).max(MAX_IMAGES_PER_REQUEST).default(1),
  size: z.string().optional(),
  negative_prompt: z.string().optional(),
  seed: z.int().min(0).max(MAX_SEED).optional(),
});

const editSchema = generationSchema.extend({
  n: integerField(z.int().min(1).max(MAX_IMAGES_PER_REQUEST)).default(1),
  seed: integerField(z.int().min(0).max(MAX_SEED)).optional(),
  images: z
    .array(z.object({ image_url: z.string().check(inputImageCheck) }))
    .min(1, "an edit needs at least one input image")
    .max(MAX_INPUT_IMAGES_PER_EDIT),
});

const featureRefusedSchema = z.object({
  response_format: z.unknown().optional(),
  stream: z.unknown().optional(),
  partial_images: z.unknown().optional(),
  mask: z.unknown().optional(),
});

export function inputImageCheck(context: z.core.ParsePayload<string>): void {
  const url = context.value;
  if (/^https?:\/\//.test(url) || url.startsWith("data:image/")) {
    return;
  }
  const dataType = /^data:([^;,]*)/.exec(url)?.[1];
  context.issues.push({
    code: "custom",
    input: url,
    message:
      dataType === undefined
        ? "an input image must be an http(s) URL or a data URI"
        : `an input image can't be of type "${dataType}"`,
  });
}

function parseGenerationRequest(body: unknown): ImageGenerationRequest {
  const { negative_prompt, seed, size, ...fields } = parseWith(generationSchema, body);
  return {
    ...fields,
    size: clientSizeIn(size),
    negativePrompt: negative_prompt ?? null,
    seed: seed ?? null,
    inputImages: [],
  };
}

function parseEditRequest(body: unknown): ImageGenerationRequest {
  const { negative_prompt, seed, size, images, ...fields } = parseWith(editSchema, body);
  return {
    ...fields,
    size: clientSizeIn(size),
    negativePrompt: negative_prompt ?? null,
    seed: seed ?? null,
    inputImages: images.map(({ image_url }) => image_url),
  };
}

function parseWith<Schema extends z.ZodType>(schema: Schema, body: unknown): z.output<Schema> {
  refuseUnsupportedFeatures(body);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new GatewayError(
      "invalid_request",
      `Invalid request: ${z.prettifyError(parsed.error)}`,
      "client",
    );
  }
  return parsed.data;
}

function clientSizeIn(size: string | undefined): ImageSize | null {
  return size === undefined || size === AUTOMATIC_SIZE ? null : imageSizeOf(size);
}

function refuseUnsupportedFeatures(body: unknown): void {
  const features = featureRefusedSchema.safeParse(body);
  if (!features.success) {
    return;
  }
  const { response_format, stream, partial_images, mask } = features.data;
  if (response_format !== undefined && response_format !== "b64_json") {
    throw unsupported("`response_format` other than `b64_json`");
  }
  if (stream !== undefined && stream !== false && stream !== "false") {
    throw unsupported("`stream`");
  }
  if (partial_images !== undefined && partial_images !== 0 && partial_images !== "0") {
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
      "client",
    );
  }
  return { width: Number(match[1]), height: Number(match[2]) };
}

function unsupported(feature: string): GatewayError {
  return new GatewayError("invalid_request", `Not supported: ${feature}`, "client");
}

function unservableReason(
  upstreamModel: SnapshotUpstreamModel,
  { size, inputImages }: ImageGenerationRequest,
): string | null {
  if (size && upstreamModel.sizes && !upstreamModel.sizes.includes(providerSizeOf(size))) {
    return `the size ${clientSizeOf(size)}`;
  }
  const { maxInputImages } = upstreamModel;
  if (maxInputImages !== null && inputImages.length > maxInputImages) {
    return `${inputImages.length} input images: it takes at most ${maxInputImages}`;
  }
  return null;
}

function writeResponse({ images }: GeneratedImages, context: MediaResponseContext): MediaReply {
  return jsonReply({
    created: Math.floor(context.createdAt.getTime() / 1000),
    data: images.map((image) => ({ b64_json: Buffer.from(image.bytes).toString("base64") })),
  });
}

export const openAiImagesClientContract: MediaClientContract<
  ImageGenerationRequest,
  GeneratedImages
> = {
  protocol: "openai-images",
  parseRequest: parseGenerationRequest,
  unservableReason,
  upstreamProtocols: { "dashscope-image": dashScopeImageProtocol },
  writeResponse,
  writeError: writeOpenAiError,
};

export const openAiImageEditsClientContract: MediaClientContract<
  ImageGenerationRequest,
  GeneratedImages
> = { ...openAiImagesClientContract, parseRequest: parseEditRequest };
