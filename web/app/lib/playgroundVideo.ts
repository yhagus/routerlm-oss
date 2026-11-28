import {
  isPlaygroundSummary,
  type PlaygroundError,
  type PlaygroundSummary,
  playgroundErrorOf,
  readProperty,
} from '~/lib/playground';
import type { RouteSummary } from '~/lib/routing';

export const VIDEO_RESOLUTIONS = ['480P', '720P', '1080P'] as const;
export type VideoResolution = (typeof VIDEO_RESOLUTIONS)[number];

export const VIDEO_RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4'] as const;
export type VideoRatio = (typeof VIDEO_RATIOS)[number];

export const MODEL_DEFAULT = 'default';
export type ResolutionChoice = VideoResolution | typeof MODEL_DEFAULT;
export type RatioChoice = VideoRatio | typeof MODEL_DEFAULT;

export const RATIO_OPTIONS: { value: RatioChoice; label: string }[] = [
  { value: MODEL_DEFAULT, label: 'Model default' },
  ...VIDEO_RATIOS.map((ratio) => ({ value: ratio, label: ratio })),
];

export const DEFAULT_VIDEO_SECONDS = 5;

export const MAX_VIDEO_SEED = 2_147_483_647;

export const VIDEO_POLL_INTERVAL_MS = 5000;

export interface VideoParameters {
  seconds?: number;
  resolution?: VideoResolution;
  aspectRatio?: VideoRatio;
  seed?: number;
}

export interface PlaygroundVideoSettings extends VideoParameters {
  model: string;
}

export type VideoStatus = 'queued' | 'in_progress' | 'completed' | 'failed' | 'expired';
const VIDEO_STATUSES: readonly string[] = [
  'queued',
  'in_progress',
  'completed',
  'failed',
  'expired',
] satisfies VideoStatus[];

export const RUNNING_STATUS_LABELS = {
  queued: 'Queued',
  in_progress: 'Generating',
} as const satisfies Partial<Record<VideoStatus, string>>;
export type RunningVideoStatus = keyof typeof RUNNING_STATUS_LABELS;

export type VideoAnswerState =
  | { kind: 'submitting' }
  | {
      kind: 'running';
      videoId: string;
      status: RunningVideoStatus;
      progress: number | null;
      summary: PlaygroundSummary;
    }
  | { kind: 'done'; videoId: string; summary: PlaygroundSummary }
  | { kind: 'failed'; error: PlaygroundError; summary: PlaygroundSummary | null }
  | { kind: 'expired'; summary: PlaygroundSummary }
  | { kind: 'stopped' };

export interface VideoExchange {
  id: number;
  prompt: string;
  parameters: string[];
  isDirect: boolean;
  routes: RouteSummary[] | null;
  submittedAt: number;
  state: VideoAnswerState;
}

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

export function videoParameterLabels(parameters: VideoParameters): string[] {
  const labels = [`${parameters.seconds ?? DEFAULT_VIDEO_SECONDS}s`];
  if (parameters.resolution) labels.push(parameters.resolution);
  if (parameters.aspectRatio) labels.push(parameters.aspectRatio);
  if (parameters.seed !== undefined) labels.push(`Seed ${parameters.seed}`);
  return labels;
}

export interface VideoObject {
  id: string;
  status: VideoStatus;
  progress: number | null;
  error: PlaygroundError | null;
}

function isVideoStatus(value: unknown): value is VideoStatus {
  return typeof value === 'string' && VIDEO_STATUSES.includes(value);
}

export function videoObjectOf(payload: unknown): VideoObject | null {
  const id = readProperty(payload, 'id');
  const status = readProperty(payload, 'status');
  if (typeof id !== 'string' || !isVideoStatus(status)) return null;
  const progress = readProperty(payload, 'progress');
  return {
    id,
    status,
    progress: typeof progress === 'number' ? progress : null,
    error: playgroundErrorOf(payload),
  };
}

export function submittedVideoJobOf(
  payload: unknown,
): { video: VideoObject; summary: PlaygroundSummary } | null {
  const video = videoObjectOf(readProperty(payload, 'response'));
  const summary = readProperty(payload, 'summary');
  return video && isPlaygroundSummary(summary) ? { video, summary } : null;
}

export function videoAnswerStateOf(
  video: VideoObject,
  summary: PlaygroundSummary,
): VideoAnswerState {
  switch (video.status) {
    case 'queued':
    case 'in_progress':
      return {
        kind: 'running',
        videoId: video.id,
        status: video.status,
        progress: video.progress,
        summary,
      };
    case 'completed':
      return { kind: 'done', videoId: video.id, summary };
    case 'failed':
      return {
        kind: 'failed',
        error: video.error ?? { code: null, message: 'The upstream failed to generate the video' },
        summary,
      };
    case 'expired':
      return { kind: 'expired', summary };
  }
}

export function videoJobPath(videoId: string): string {
  return `/playground/videos/${encodeURIComponent(videoId)}`;
}

export function videoContentUrl(videoId: string): string {
  return `/api${videoJobPath(videoId)}/content`;
}

export function waitFor(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
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

export function videoFileName(exchangeId: number): string {
  return `video-${exchangeId}.mp4`;
}
