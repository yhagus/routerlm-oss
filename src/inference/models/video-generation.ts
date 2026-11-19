import type { Capability } from "@/db/schemas/index.js";
import type {
  MediaExchange,
  MediaRequest,
  MediaUpstreamProtocol,
  MediaUpstreamTarget,
} from "./media-kind.js";

// The video Kind's internal format (ADR 0002, once per Kind; ADR 0027).

/** The resolutions Alibaba prices video by. */
export const VIDEO_RESOLUTIONS = ["480P", "720P", "1080P"] as const;
export type VideoResolution = (typeof VIDEO_RESOLUTIONS)[number];

/** The pixels of a frame's shorter side at each resolution. */
const SHORTER_SIDE_OF_RESOLUTION = {
  "480P": 480,
  "720P": 720,
  "1080P": 1080,
} as const satisfies Record<VideoResolution, number>;

/** The aspect ratios DashScope's video models take as `ratio`. */
export const VIDEO_RATIOS = ["16:9", "9:16", "1:1", "4:3", "3:4"] as const;
export type VideoRatio = (typeof VIDEO_RATIOS)[number];

/** Where an input image goes in the video, as DashScope's `input.media[].type` names it. */
export type VideoMediaRole = "first_frame" | "last_frame" | "reference_image";

/** An input image: a data URI or an https URL, passed to the Provider as given. */
export interface VideoMediaInput {
  role: VideoMediaRole;
  url: string;
}

/** A video request as the video Kind's upstream Protocols read it. */
export interface VideoGenerationRequest extends MediaRequest {
  prompt: string;
  /** The requested duration; never left to the Provider, so the Cost is known at submit (ADR 0027). */
  seconds: number;
  resolution: VideoResolution;
  /** Null leaves the ratio to the model. */
  ratio: VideoRatio | null;
  /** The `size` the client asked for, echoed in the video object; null when it named a resolution. */
  clientSize: string | null;
  /** The images the video starts from, ends on or is guided by; empty for text-to-video. */
  media: VideoMediaInput[];
  seed: number | null;
}

/** A Video Job a Provider accepted: the request, and the upstream task to poll. */
export interface SubmittedVideoJob {
  request: VideoGenerationRequest;
  taskId: string;
}

/** A Video Job's state as the client sees it (OpenAI's video `status`). */
export type VideoTaskState =
  | { status: "queued" }
  | { status: "in_progress" }
  /** `completedAt` is null when the Provider doesn't say when it finished. */
  | { status: "completed"; videoUrl: string; completedAt: Date | null }
  | { status: "failed"; completedAt: Date | null }
  | { status: "expired" };

/** A video Protocol: submits through the Fallback loop, then reads the task with one call. */
export interface VideoUpstreamProtocol extends MediaUpstreamProtocol<
  VideoGenerationRequest,
  SubmittedVideoJob
> {
  readTask(
    taskId: string,
    target: MediaUpstreamTarget,
    exchange: MediaExchange,
  ): Promise<VideoTaskState>;
}

/** The Capability each input image needs (spec "Video Capabilities"). */
const CAPABILITY_OF_MEDIA_ROLE = {
  first_frame: "first-frame",
  last_frame: "last-frame",
  reference_image: "reference-images",
} as const satisfies Record<VideoMediaRole, Capability>;

/** The Capabilities a Route must have to serve the request: text-to-video when it has no image. */
export function requiredCapabilitiesOf({ media }: VideoGenerationRequest): Capability[] {
  if (media.length === 0) {
    return ["text-to-video"];
  }
  return [...new Set(media.map(({ role }) => CAPABILITY_OF_MEDIA_ROLE[role]))];
}

/**
 * The resolution and ratio of a `WIDTHxHEIGHT` size: the resolution nearest
 * its shorter side, and the ratio its sides reduce to exactly. Null when they
 * reduce to no ratio DashScope takes.
 */
export function videoFormatOfSize(
  width: number,
  height: number,
): { resolution: VideoResolution; ratio: VideoRatio } | null {
  const divisor = greatestCommonDivisor(width, height);
  const reduced = `${width / divisor}:${height / divisor}`;
  const ratio = VIDEO_RATIOS.find((candidate) => candidate === reduced);
  if (ratio === undefined) {
    return null;
  }
  return { resolution: nearestResolution(Math.min(width, height)), ratio };
}

function nearestResolution(shorterSide: number): VideoResolution {
  const distanceOf = (resolution: VideoResolution): number =>
    Math.abs(SHORTER_SIDE_OF_RESOLUTION[resolution] - shorterSide);
  return VIDEO_RESOLUTIONS.reduce<VideoResolution>(
    (nearest, candidate) => (distanceOf(candidate) < distanceOf(nearest) ? candidate : nearest),
    "720P",
  );
}

function greatestCommonDivisor(a: number, b: number): number {
  return b === 0 ? a : greatestCommonDivisor(b, a % b);
}
