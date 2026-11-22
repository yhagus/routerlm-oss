import { Injectable } from "@nestjs/common";
import { OutboundFetch } from "@/libs/providers/outbound-fetch.js";
import { AttemptFailedError } from "@/inference/models/attempt-failure.js";
import type { FetchedMedia } from "@/inference/models/media-kind.js";

/** A generated file on its way through the gateway, read as it arrives. */
export interface StreamedMedia {
  body: ReadableStream<Uint8Array>;
  contentType: string;
}

/** What a file is called when its host names no content type. */
const UNKNOWN_CONTENT_TYPE = "application/octet-stream";

/**
 * Downloads the files a Provider generated, so the gateway relays their bytes
 * and never the Provider's URL (ADR 0028). Media hosts are the Provider's
 * choice, so every fetch goes through OutboundFetch: https only, and never a
 * private or internal address unless the deployment allows private
 * upstreams. Redirects are refused rather than followed to a host nobody
 * checked. No credential is sent, and nothing is written to disk or the
 * database (ADR 0004).
 */
@Injectable()
export class MediaFetcher {
  constructor(private readonly outbound: OutboundFetch) {}

  /** Throws AttemptFailedError for an answer other than 2xx; `signal` carries the Attempt's deadline. */
  async fetch(url: string, signal: AbortSignal): Promise<FetchedMedia> {
    const response = await this.open(url, signal);
    return {
      bytes: new Uint8Array(await response.arrayBuffer()),
      contentType: response.headers.get("content-type") ?? UNKNOWN_CONTENT_TYPE,
    };
  }

  /**
   * As `fetch`, but hands the body on as it arrives, for a file too large to
   * hold (a video). `signal` aborts the download, such as when the client leaves.
   */
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
      // The media host's status, not the Provider API's: it says nothing about the credential.
      throw new AttemptFailedError(
        "server_error",
        null,
        `The generated media could not be fetched (HTTP ${response.status})`,
      );
    }
    return response;
  }
}
