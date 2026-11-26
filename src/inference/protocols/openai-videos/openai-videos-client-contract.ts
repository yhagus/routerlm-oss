import { z } from "zod";
import type { UpstreamProtocol } from "@/db/schemas";
import type { SnapshotUpstreamModel } from "@/snapshot/models/snapshot";
import { GatewayError } from "@/inference/models/gateway-error";
import {
  jsonReply,
  type MediaClientContract,
  type MediaResponseContext,
} from "@/inference/models/media-kind";
import {
  requiredCapabilitiesOf,
  type SubmittedVideoJob,
  VIDEO_RATIOS,
  VIDEO_RESOLUTIONS,
  type VideoGenerationRequest,
  type VideoMediaInput,
  type VideoRatio,
  type VideoResolution,
  type VideoTaskState,
  type VideoUpstreamProtocol,
  videoFormatOfSize,
} from "@/inference/models/video-generation";
import {
  type VideoHandles,
  type VideoJobHandle,
  videoJobOwnerOf,
} from "@/inference/providers/video-handles";
import { dashScopeVideoProtocol } from "@/inference/protocols/dashscope-video/dashscope-video-protocol";
import { writeOpenAiError } from "@/inference/protocols/openai-chat/openai-error";
import { inputImageCheck } from "@/inference/protocols/openai-images/openai-images-client-contract";

const DEFAULT_SECONDS = 5;
const DEFAULT_RESOLUTION: VideoResolution = "720P";
const PROVIDER_CHOSEN_SECONDS = -1;
const MAX_SEED = 2_147_483_647;
const CLIENT_SIZE = /^(\d+)x(\d+)$/;
const SECONDS = /^-?\d+$/;

const imageUrlSchema = z
  .union([z.string(), z.object({ url: z.string() }).transform(({ url }) => url)])
  .pipe(z.string().check(inputImageCheck));

const imagePartTypeSchema = z.literal("image_url").optional();

const requestSchema = z.object({
  model: z.string().min(1),
  prompt: z.string().min(1),
  seconds: z.union([z.int(), z.string().regex(SECONDS).transform(Number)]).optional(),
  size: z.string().optional(),
  resolution: z
    .string()
    .transform((resolution) => resolution.toUpperCase())
    .pipe(z.enum(VIDEO_RESOLUTIONS))
    .optional(),
  aspect_ratio: z.enum(VIDEO_RATIOS).optional(),
  seed: z
    .union([z.int(), z.string().regex(SECONDS).transform(Number)])
    .pipe(z.int().min(0).max(MAX_SEED))
    .optional(),
  input_reference: z.object({ image_url: imageUrlSchema }).optional(),
  frame_images: z
    .array(
      z.object({
        type: imagePartTypeSchema,
        frame_type: z.enum(["first_frame", "last_frame"]),
        image_url: imageUrlSchema,
      }),
    )
    .optional(),
  input_references: z
    .array(z.object({ type: imagePartTypeSchema, image_url: imageUrlSchema }))
    .optional(),
});
type ParsedVideoRequest = z.infer<typeof requestSchema>;

function parseRequest(body: unknown): VideoGenerationRequest {
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    throw invalid(z.prettifyError(parsed.error));
  }
  const { model, prompt, seconds, size, resolution, aspect_ratio, seed } = parsed.data;
  const media = mediaOf(parsed.data);
  const format = videoFormatOf(size, resolution, aspect_ratio);
  const hasFirstFrame = media.some(({ role }) => role === "first_frame");
  return {
    model,
    prompt,
    seconds: requestedSecondsOf(seconds),
    resolution: format.resolution,
    ratio: hasFirstFrame ? null : format.ratio,
    clientSize: size ?? null,
    media,
    seed: seed ?? null,
  };
}

function mediaOf({
  input_reference,
  frame_images = [],
  input_references = [],
}: ParsedVideoRequest): VideoMediaInput[] {
  const firstFrames = frame_images.filter(({ frame_type }) => frame_type === "first_frame");
  const lastFrames = frame_images.filter(({ frame_type }) => frame_type === "last_frame");
  const firstFrameUrls = [
    ...(input_reference ? [input_reference.image_url] : []),
    ...firstFrames.map(({ image_url }) => image_url),
  ];
  if (firstFrameUrls.length > 1) {
    throw invalid("send one first frame, in either `input_reference` or `frame_images`");
  }
  if (lastFrames.length > 1) {
    throw invalid("send at most one last frame");
  }
  return [
    ...firstFrameUrls.map((url): VideoMediaInput => ({ role: "first_frame", url })),
    ...lastFrames.map(({ image_url }): VideoMediaInput => ({ role: "last_frame", url: image_url })),
    ...input_references.map(({ image_url }): VideoMediaInput => ({
      role: "reference_image",
      url: image_url,
    })),
  ];
}

function requestedSecondsOf(seconds: number | undefined): number {
  if (seconds === undefined) {
    return DEFAULT_SECONDS;
  }
  if (seconds === PROVIDER_CHOSEN_SECONDS) {
    throw new GatewayError(
      "invalid_request",
      "Not supported: `seconds` of -1, which leaves the duration to the Provider",
      "client",
    );
  }
  if (seconds <= 0) {
    throw invalid("`seconds` must be a positive whole number");
  }
  return seconds;
}

function videoFormatOf(
  size: string | undefined,
  resolution: VideoResolution | undefined,
  aspectRatio: VideoRatio | undefined,
): { resolution: VideoResolution; ratio: VideoRatio | null } {
  if (size === undefined) {
    return { resolution: resolution ?? DEFAULT_RESOLUTION, ratio: aspectRatio ?? null };
  }
  if (resolution !== undefined || aspectRatio !== undefined) {
    throw invalid("send either `size` or `resolution` and `aspect_ratio`, not both");
  }
  const match = CLIENT_SIZE.exec(size);
  const format = match && videoFormatOfSize(Number(match[1]), Number(match[2]));
  if (!format) {
    throw invalid(
      `the size "${size}" is not WIDTHxHEIGHT in an aspect ratio of ${VIDEO_RATIOS.join(", ")}`,
    );
  }
  return format;
}

function invalid(reason: string): GatewayError {
  return new GatewayError("invalid_request", `Invalid request: ${reason}`, "client");
}

function unservableReason(
  upstreamModel: SnapshotUpstreamModel,
  request: VideoGenerationRequest,
): string | null {
  const missingCapability = requiredCapabilitiesOf(request).find(
    (capability) => !upstreamModel.capabilities.includes(capability),
  );
  if (missingCapability !== undefined) {
    return `a request that needs the Capability ${missingCapability}`;
  }
  const { maxInputImages } = upstreamModel;
  if (maxInputImages !== null && request.media.length > maxInputImages) {
    return `${request.media.length} input images: it takes at most ${maxInputImages}`;
  }
  if (upstreamModel.resolutions && !upstreamModel.resolutions.includes(request.resolution)) {
    return `the resolution ${request.resolution}`;
  }
  const { minDurationSeconds, maxDurationSeconds } = upstreamModel;
  if (
    (minDurationSeconds !== null && request.seconds < minDurationSeconds) ||
    (maxDurationSeconds !== null && request.seconds > maxDurationSeconds)
  ) {
    return `a video of ${request.seconds} seconds`;
  }
  return null;
}

export const VIDEO_UPSTREAM_PROTOCOLS: Partial<Record<UpstreamProtocol, VideoUpstreamProtocol>> = {
  "dashscope-video": dashScopeVideoProtocol,
};

export function videoObjectOf(
  videoId: string,
  handle: VideoJobHandle,
  state: VideoTaskState,
): unknown {
  const completedAt =
    (state.status === "completed" || state.status === "failed") && state.completedAt
      ? { completed_at: Math.floor(state.completedAt.getTime() / 1000) }
      : {};
  return {
    id: videoId,
    object: "video",
    status: state.status,
    model: handle.modelName,
    seconds: String(handle.seconds),
    size: handle.size,
    created_at: handle.createdAt,
    ...completedAt,
    ...(state.status === "failed" && {
      error: {
        code: "video_generation_failed",
        message: "The upstream failed to generate the video",
      },
    }),
  };
}

export function openAiVideosClientContract(
  handles: VideoHandles,
): MediaClientContract<VideoGenerationRequest, SubmittedVideoJob> {
  return {
    protocol: "openai-videos",
    parseRequest,
    unservableReason,
    upstreamProtocols: VIDEO_UPSTREAM_PROTOCOLS,
    writeResponse: ({ request, taskId }, context: MediaResponseContext) => {
      const handle: VideoJobHandle = {
        owner: videoJobOwnerOf(context.caller),
        providerAccountId: context.servedBy.providerAccountId,
        upstreamModelRowId: context.servedBy.upstreamModelRowId,
        taskId,
        modelName: context.modelName,
        createdAt: Math.floor(context.createdAt.getTime() / 1000),
        seconds: request.seconds,
        resolution: request.resolution,
        size: request.clientSize,
      };
      return jsonReply(videoObjectOf(handles.seal(handle), handle, { status: "queued" }));
    },
    writeError: writeOpenAiError,
  };
}
