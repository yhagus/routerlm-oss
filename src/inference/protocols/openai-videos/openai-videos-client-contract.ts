import { z } from "zod";
import type { UpstreamProtocol } from "@/db/schemas/index.js";
import type { SnapshotUpstreamModel } from "@/snapshot/models/snapshot.js";
import { GatewayError } from "../../models/gateway-error.js";
import type { MediaClientContract, MediaResponseContext } from "../../models/media-kind.js";
import {
  requiredCapabilitiesOf,
  type SubmittedVideoJob,
  VIDEO_RATIOS,
  VIDEO_RESOLUTIONS,
  type VideoGenerationRequest,
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
  seed: z.int().min(0).max(MAX_SEED).optional(),
});

function parseRequest(body: unknown): VideoGenerationRequest {
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    throw invalid(z.prettifyError(parsed.error));
  }
  const { model, prompt, seconds, size, resolution, aspect_ratio, seed } = parsed.data;
  return {
    model,
    prompt,
    seconds: requestedSecondsOf(seconds),
    ...videoFormatOf(size, resolution, aspect_ratio),
    clientSize: size ?? null,
    // Text to video only for now; image inputs are parsed here too once accepted (#74).
    media: [],
    seed: seed ?? null,
  };
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
      return videoObjectOf(handles.seal(handle), handle, { status: "queued" });
    },
    // The same envelope as Chat Completions: both are OpenAI's.
    writeError: (error) => openAiChatClientConverter.writeError(error),
  };
}
