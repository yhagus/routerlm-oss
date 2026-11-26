import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { ProviderKeyCipher } from '@/upstream/providers/provider-key-cipher';
import type { InferenceCaller } from '@/inference/models/inference';
import { VIDEO_RESOLUTIONS } from '@/inference/models/video-generation';

const VIDEO_ID_PREFIX = 'video_';
const VIDEO_HANDLE_PURPOSE = 'video-handle';

const videoJobHandleSchema = z.object({
  owner: z.string(),
  providerAccountId: z.string(),
  upstreamModelRowId: z.string(),
  taskId: z.string(),
  modelName: z.string(),
  createdAt: z.int(),
  seconds: z.int(),
  resolution: z.enum(VIDEO_RESOLUTIONS),
  size: z.string().nullable(),
});

export type VideoJobHandle = z.infer<typeof videoJobHandleSchema>;

export function videoJobOwnerOf(caller: InferenceCaller): string {
  return caller.kind === 'api-key'
    ? `api-key:${caller.principal.apiKeyId}`
    : `user:${caller.userId}`;
}

@Injectable()
export class VideoHandles {
  constructor(private readonly cipher: ProviderKeyCipher) {}

  seal(handle: VideoJobHandle): string {
    return `${VIDEO_ID_PREFIX}${this.cipher.encrypt(JSON.stringify(handle), VIDEO_HANDLE_PURPOSE)}`;
  }

  open(videoId: string, caller: InferenceCaller): VideoJobHandle | null {
    if (!videoId.startsWith(VIDEO_ID_PREFIX)) {
      return null;
    }
    let plaintext: string;
    try {
      plaintext = this.cipher.decrypt(videoId.slice(VIDEO_ID_PREFIX.length), VIDEO_HANDLE_PURPOSE);
    } catch {
      return null;
    }
    const handle = videoJobHandleSchema.safeParse(JSON.parse(plaintext));
    if (!handle.success || handle.data.owner !== videoJobOwnerOf(caller)) {
      return null;
    }
    return handle.data;
  }
}
