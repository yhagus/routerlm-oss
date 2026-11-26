import { Injectable } from "@nestjs/common";
import { OutboundFetch } from "@/libs/providers/outbound-fetch";
import { AttemptFailedError } from "@/inference/models/attempt-failure";
import type { FetchedMedia } from "@/inference/models/media-kind";

export interface StreamedMedia {
  body: ReadableStream<Uint8Array>;
  contentType: string;
}

const UNKNOWN_CONTENT_TYPE = "application/octet-stream";

@Injectable()
export class MediaFetcher {
  constructor(private readonly outbound: OutboundFetch) {}

  async fetch(url: string, signal: AbortSignal): Promise<FetchedMedia> {
    const response = await this.open(url, signal);
    return {
      bytes: new Uint8Array(await response.arrayBuffer()),
      contentType: response.headers.get("content-type") ?? UNKNOWN_CONTENT_TYPE,
    };
  }

  async stream(url: string, signal: AbortSignal): Promise<StreamedMedia> {
    const response = await this.open(url, signal);
    if (!response.body) {
      throw new AttemptFailedError("server_error", null, "The generated media came without a body");
    }
    return {
      body: response.body,
      contentType: response.headers.get("content-type") ?? UNKNOWN_CONTENT_TYPE,
    };
  }

  private async open(url: string, signal: AbortSignal): Promise<Response> {
    const response = await this.outbound.fetch(url, { signal, redirect: "error" });
    if (!response.ok) {
      await response.body?.cancel();
      throw new AttemptFailedError(
        "server_error",
        null,
        `The generated media could not be fetched (HTTP ${response.status})`,
      );
    }
    return response;
  }
}
