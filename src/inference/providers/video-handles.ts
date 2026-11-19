import { Injectable } from "@nestjs/common";
import { z } from "zod";
import { ProviderKeyCipher } from "@/upstream/providers/provider-key-cipher.js";
import type { InferenceCaller } from "../models/inference.js";
import { VIDEO_RESOLUTIONS } from "../models/video-generation.js";

/** What every video id starts with, as OpenAI's do. */
const VIDEO_ID_PREFIX = "video_";
/** Authenticated with every handle, so no other ciphertext of the gateway's opens as one. */
const VIDEO_HANDLE_PURPOSE = "video-handle";

const videoJobHandleSchema = z.object({
  owner: z.string(),
  providerAccountId: z.string(),
  upstreamModelRowId: z.string(),
  taskId: z.string(),
  modelName: z.string(),
  /** Unix seconds. */
  createdAt: z.int(),
  seconds: z.int(),
  resolution: z.enum(VIDEO_RESOLUTIONS),
  size: z.string().nullable(),
});

/**
 * Everything a poll needs to reach the upstream task again, sealed into the
 * video id instead of a stored job (ADR 0027).
 */
export type VideoJobHandle = z.infer<typeof videoJobHandleSchema>;

/** Who may poll a handle: the API Key, or the Playground User, that submitted it. */
export function videoJobOwnerOf(caller: InferenceCaller): string {
  return caller.kind === "api-key"
    ? `api-key:${caller.principal.apiKeyId}`
    : `user:${caller.userId}`;
}

/**
 * Seals Video Job handles into video ids and opens them again, with the
 * Provider Account key cipher under a purpose of its own (ADR 0027). Rotating
 * the encryption key invalidates every outstanding id.
 */
@Injectable()
export class VideoHandles {
  constructor(private readonly cipher: ProviderKeyCipher) {}

  seal(handle: VideoJobHandle): string {
    return `${VIDEO_ID_PREFIX}${this.cipher.encrypt(JSON.stringify(handle), VIDEO_HANDLE_PURPOSE)}`;
  }

  /** The handle of a video id the gateway issued to `caller`; null for any other id. */
  open(videoId: string, caller: InferenceCaller): VideoJobHandle | null {
    if (!videoId.startsWith(VIDEO_ID_PREFIX)) {
      return null;
    }
    let plaintext: string;
    try {
      plaintext = this.cipher.decrypt(videoId.slice(VIDEO_ID_PREFIX.length), VIDEO_HANDLE_PURPOSE);
    } catch {
      return null; // Tampered with, forged, or sealed under another encryption key.
    }
    const handle = videoJobHandleSchema.safeParse(JSON.parse(plaintext));
    if (!handle.success || handle.data.owner !== videoJobOwnerOf(caller)) {
      return null;
    }
    return handle.data;
  }
}
