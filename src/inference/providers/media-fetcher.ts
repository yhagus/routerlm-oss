import { Injectable } from "@nestjs/common";
import { OutboundFetch } from "@/libs/providers/outbound-fetch.js";
import { AttemptFailedError } from "../models/attempt-failure.js";
import type { FetchedMedia } from "../models/media-kind.js";

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
    return {
      bytes: new Uint8Array(await response.arrayBuffer()),
      contentType: response.headers.get("content-type") ?? UNKNOWN_CONTENT_TYPE,
    };
  }
}
