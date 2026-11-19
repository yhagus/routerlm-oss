import { z } from "zod";
import type { UpstreamProtocol } from "@/db/schemas/index.js";
import type { SnapshotUpstreamModel } from "@/snapshot/models/snapshot.js";
import { GatewayError } from "../../models/gateway-error.js";
import {
  jsonReply,
  type MediaClientContract,
  type MediaResponseContext,
} from "../../models/media-kind.js";
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
} from "../../models/video-generation.js";
import {
  type VideoHandles,
  type VideoJobHandle,
  videoJobOwnerOf,
} from "../../providers/video-handles.js";
import { dashScopeVideoProtocol } from "../dashscope-video/dashscope-video-protocol.js";
import { openAiChatClientConverter } from "../openai-chat/openai-chat-client-converter.js";
import { inputImageCheck } from "../openai-images/openai-images-client-contract.js";

// OpenAI's Videos API, `POST /v1/videos`, with OpenRouter's `resolution` and
// `aspect_ratio` accepted in place of `size` (spec "Phase 4: video").

/** DashScope's own default duration, used when the client names none. */
const DEFAULT_SECONDS = 5;
/** The resolution used when the client names neither a size nor a resolution. */
const DEFAULT_RESOLUTION: VideoResolution = "720P";
/** The `seconds` that would let the Provider choose: its Cost isn't known at submit (ADR 0027). */
const PROVIDER_CHOSEN_SECONDS = -1;
/** DashScope's seed range. */
const MAX_SEED = 2_147_483_647;
const CLIENT_SIZE = /^(\d+)x(\d+)$/;
const SECONDS = /^-?\d+$/;

/** An image URL as a string (OpenAI) or nested as `{url}` (OpenRouter): an http(s) URL or a data URI. */
const imageUrlSchema = z
  .union([z.string(), z.object({ url: z.string() }).transform(({ url }) => url)])
  .pipe(z.string().check(inputImageCheck));

/** OpenRouter's content-part `type`; only images are taken. */
const imagePartTypeSchema = z.literal("image_url").optional();

// A plain (non-strict) object: unknown fields are dropped (ADR 0002).
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
  // A string in a multipart form.
  seed: z
    .union([z.int(), z.string().regex(SECONDS).transform(Number)])
    .pipe(z.int().min(0).max(MAX_SEED))
    .optional(),
  /** OpenAI's first frame. */
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
    // The video takes its first frame's aspect ratio (spec "Sizes").
    ratio: hasFirstFrame ? null : format.ratio,
    clientSize: size ?? null,
    media,
    seed: seed ?? null,
  };
}

/** The input images in DashScope's order: the frames, then the references. */
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
    );
  }
  if (seconds <= 0) {
    throw invalid("`seconds` must be a positive whole number");
  }
  return seconds;
}

/** The resolution and ratio a `size`, or a `resolution` and `aspect_ratio`, ask for. */
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
  return new GatewayError("invalid_request", `Invalid request: ${reason}`);
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

/** The video Protocols, by name: a poll reads the task in the Protocol of the Upstream Model's endpoint. */
export const VIDEO_UPSTREAM_PROTOCOLS: Partial<Record<UpstreamProtocol, VideoUpstreamProtocol>> = {
  "dashscope-video": dashScopeVideoProtocol,
};

/** An OpenAI video object: what the create call and every poll answer with. */
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
    // Our own words: the Provider's error text is never forwarded.
    ...(state.status === "failed" && {
      error: {
        code: "video_generation_failed",
        message: "The upstream failed to generate the video",
      },
    }),
  };
}

/**
 * The client contract of `POST /v1/videos`. Its response seals where the job
 * went into the video id (ADR 0027), so it needs the gateway's VideoHandles.
 */
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
    // The same envelope as Chat Completions: both are OpenAI's.
    writeError: (error) => openAiChatClientConverter.writeError(error),
  };
}
