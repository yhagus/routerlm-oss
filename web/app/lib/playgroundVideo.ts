// The Playground's video tab: the OpenAI Videos body it submits, the video
// object every poll answers with, and where the finished MP4 is streamed from.

import {
  isPlaygroundSummary,
  type PlaygroundError,
  type PlaygroundSummary,
  playgroundErrorOf,
  readProperty,
} from "~/lib/playground";
import type { RouteSummary } from "~/lib/routing";

/** The resolutions the gateway's video endpoint takes, as the backend's `VIDEO_RESOLUTIONS` says. */
export const VIDEO_RESOLUTIONS = ["480P", "720P", "1080P"] as const;
export type VideoResolution = (typeof VIDEO_RESOLUTIONS)[number];

/** The aspect ratios it takes, as the backend's `VIDEO_RATIOS` says. */
export const VIDEO_RATIOS = ["16:9", "9:16", "1:1", "4:3", "3:4"] as const;
export type VideoRatio = (typeof VIDEO_RATIOS)[number];

/** A select's choice to send nothing, so the Model decides. */
export const MODEL_DEFAULT = "default";
export type ResolutionChoice = VideoResolution | typeof MODEL_DEFAULT;
export type RatioChoice = VideoRatio | typeof MODEL_DEFAULT;

export const RATIO_OPTIONS: { value: RatioChoice; label: string }[] = [
  { value: MODEL_DEFAULT, label: "Model default" },
  ...VIDEO_RATIOS.map((ratio) => ({ value: ratio, label: ratio })),
];

/** What the gateway uses when no duration is sent. */
export const DEFAULT_VIDEO_SECONDS = 5;

/** DashScope's seed range, the widest a Provider of ours takes. */
export const MAX_VIDEO_SEED = 2_147_483_647;

/** How often a running Video Job is polled; a job takes minutes, so there is no rush. */
export const VIDEO_POLL_INTERVAL_MS = 5000;

/** Parameters left undefined are not sent, so the gateway's defaults apply. */
export interface VideoParameters {
  seconds?: number;
  resolution?: VideoResolution;
  aspectRatio?: VideoRatio;
  seed?: number;
}

export interface PlaygroundVideoSettings extends VideoParameters {
  model: string;
}

/** A Video Job's status as OpenAI's video object names it. */
export type VideoStatus = "queued" | "in_progress" | "completed" | "failed" | "expired";
const VIDEO_STATUSES: readonly string[] = [
  "queued",
  "in_progress",
  "completed",
  "failed",
  "expired",
] satisfies VideoStatus[];

export const RUNNING_STATUS_LABELS = {
  queued: "Queued",
  in_progress: "Generating",
} as const satisfies Partial<Record<VideoStatus, string>>;
export type RunningVideoStatus = keyof typeof RUNNING_STATUS_LABELS;

export type VideoAnswerState =
  | { kind: "submitting" }
  | {
      kind: "running";
      videoId: string;
      status: RunningVideoStatus;
      /** Percent done, when the gateway says. */
      progress: number | null;
      summary: PlaygroundSummary;
    }
  | { kind: "done"; videoId: string; summary: PlaygroundSummary }
  | { kind: "failed"; error: PlaygroundError; summary: PlaygroundSummary | null }
  | { kind: "expired"; summary: PlaygroundSummary }
  | { kind: "stopped" };

/** One Video Job in the tab's history and how far it got. */
export interface VideoExchange {
  id: number;
  prompt: string;
  /** The parameters sent, as short labels such as `720P`. */
  parameters: string[];
  /** Sent straight to an Upstream Model, with no Model or Route. */
  isDirect: boolean;
  /** The Model's Routes when it was sent, for the receipt; null when direct or not loaded. */
  routes: RouteSummary[] | null;
  /** When it was submitted, to show how long it has run. */
  submittedAt: number;
  state: VideoAnswerState;
}

/** The OpenAI Videos body for one Video Job. */
export function videoRequestOf(
  settings: PlaygroundVideoSettings,
  prompt: string,
): Record<string, unknown> {
  return {
    model: settings.model,
    prompt,
    seconds: settings.seconds,
    resolution: settings.resolution,
    aspect_ratio: settings.aspectRatio,
    seed: settings.seed,
  };
}

/** The short labels for the parameters a Video Job sends. */
export function videoParameterLabels(parameters: VideoParameters): string[] {
  const labels = [`${parameters.seconds ?? DEFAULT_VIDEO_SECONDS}s`];
  if (parameters.resolution) labels.push(parameters.resolution);
  if (parameters.aspectRatio) labels.push(parameters.aspectRatio);
  if (parameters.seed !== undefined) labels.push(`Seed ${parameters.seed}`);
  return labels;
}

/** What a video object says about its job. */
export interface VideoObject {
  id: string;
  status: VideoStatus;
  progress: number | null;
  /** Set when the job failed. */
  error: PlaygroundError | null;
}

function isVideoStatus(value: unknown): value is VideoStatus {
  return typeof value === "string" && VIDEO_STATUSES.includes(value);
}

/** An OpenAI video object, or null if `payload` isn't one. */
export function videoObjectOf(payload: unknown): VideoObject | null {
  const id = readProperty(payload, "id");
  const status = readProperty(payload, "status");
  if (typeof id !== "string" || !isVideoStatus(status)) return null;
  const progress = readProperty(payload, "progress");
  return {
    id,
    status,
    progress: typeof progress === "number" ? progress : null,
    error: playgroundErrorOf(payload),
  };
}

/** The Playground's answer to a submit, `{response, summary}`, or null if it isn't one. */
export function submittedVideoJobOf(
  payload: unknown,
): { video: VideoObject; summary: PlaygroundSummary } | null {
  const video = videoObjectOf(readProperty(payload, "response"));
  const summary = readProperty(payload, "summary");
  return video && isPlaygroundSummary(summary) ? { video, summary } : null;
}

/** The answer state a video object stands for, keeping the submit's summary. */
export function videoAnswerStateOf(
  video: VideoObject,
  summary: PlaygroundSummary,
): VideoAnswerState {
  switch (video.status) {
    case "queued":
    case "in_progress":
      return {
        kind: "running",
        videoId: video.id,
        status: video.status,
        progress: video.progress,
        summary,
      };
    case "completed":
      return { kind: "done", videoId: video.id, summary };
    case "failed":
      return {
        kind: "failed",
        error: video.error ?? { code: null, message: "The upstream failed to generate the video" },
        summary,
      };
    case "expired":
      return { kind: "expired", summary };
  }
}

/** The Playground path of a Video Job, for `$dashboardApi`. */
export function videoJobPath(videoId: string): string {
  return `/playground/videos/${encodeURIComponent(videoId)}`;
}

/** Where the browser loads a completed Video Job's MP4: same origin, so the session cookie goes along. */
export function videoContentUrl(videoId: string): string {
  return `/api${videoJobPath(videoId)}/content`;
}

/** Resolves after `ms`, or rejects at once when `signal` aborts. */
export function waitFor(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

export function isVideoResolution(value: string): value is VideoResolution {
  return VIDEO_RESOLUTIONS.some((resolution) => resolution === value);
}

/** A download name for a video, such as `video-3.mp4`. */
export function videoFileName(exchangeId: number): string {
  return `video-${exchangeId}.mp4`;
}
