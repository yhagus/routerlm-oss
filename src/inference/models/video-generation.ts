import type { Capability } from '@/db/schemas';
import type {
  MediaExchange,
  MediaRequest,
  MediaUpstreamProtocol,
  MediaUpstreamTarget,
} from './media-kind';

export const VIDEO_RESOLUTIONS = ['480P', '720P', '1080P'] as const;
export type VideoResolution = (typeof VIDEO_RESOLUTIONS)[number];

const SHORTER_SIDE_OF_RESOLUTION = {
  '480P': 480,
  '720P': 720,
  '1080P': 1080,
} as const satisfies Record<VideoResolution, number>;

export const VIDEO_RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4'] as const;
export type VideoRatio = (typeof VIDEO_RATIOS)[number];

export type VideoMediaRole = 'first_frame' | 'last_frame' | 'reference_image';

export interface VideoMediaInput {
  role: VideoMediaRole;
  url: string;
}

export interface VideoGenerationRequest extends MediaRequest {
  prompt: string;
  seconds: number;
  resolution: VideoResolution;
  ratio: VideoRatio | null;
  clientSize: string | null;
  media: VideoMediaInput[];
  seed: number | null;
}

export interface SubmittedVideoJob {
  request: VideoGenerationRequest;
  taskId: string;
}

export type VideoTaskState =
  | { status: 'queued' }
  | { status: 'in_progress' }
  | { status: 'completed'; videoUrl: string; completedAt: Date | null }
  | { status: 'failed'; completedAt: Date | null }
  | { status: 'expired' };

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

const CAPABILITY_OF_MEDIA_ROLE = {
  first_frame: 'first-frame',
  last_frame: 'last-frame',
  reference_image: 'reference-images',
} as const satisfies Record<VideoMediaRole, Capability>;

export function requiredCapabilitiesOf({ media }: VideoGenerationRequest): Capability[] {
  if (media.length === 0) {
    return ['text-to-video'];
  }
  return [...new Set(media.map(({ role }) => CAPABILITY_OF_MEDIA_ROLE[role]))];
}

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
    '720P',
  );
}

function greatestCommonDivisor(a: number, b: number): number {
  return b === 0 ? a : greatestCommonDivisor(b, a % b);
}
