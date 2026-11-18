import { lookup } from "node:dns/promises";
import { Injectable } from "@nestjs/common";
import { bareHostname } from "../models/url.js";
import {
  allowsPrivateUpstreams,
  isPrivateAddress,
  isPublicHttpsUrl,
} from "../schemas/provider-url.schema.js";

/** Thrown before any connection is made, so no credential leaves the gateway. */
export class PrivateUpstreamError extends Error {
  constructor(hostname: string, reason: string) {
    super(
      `Refused to connect to ${hostname}: ${reason} (set ALLOW_PRIVATE_UPSTREAMS=true to allow it)`,
    );
  }
}

function urlOf(input: Parameters<typeof fetch>[0]): URL {
  return new URL(input instanceof Request ? input.url : input);
}

/**
 * The `fetch` of every client that sends a Provider's credential. Unless the
 * deployment allows private upstreams (ADR 0019) it refuses a URL that is not
 * https or whose host is a private literal, which a stored URL can be after the
 * policy tightened, and a host that resolves privately. A public-looking name that resolves privately, or that
 * changes later (DNS rebinding), is caught here and not by the write-time schema.
 * The connection resolves the name again, so a rebind in the milliseconds between
 * the check and the connect is not covered.
 */
@Injectable()
export class OutboundFetch {
  readonly fetch: typeof globalThis.fetch = async (input, init) => {
    if (!allowsPrivateUpstreams()) {
      await this.assertPublicUpstream(urlOf(input));
    }
    return globalThis.fetch(input, init);
  };

  private async assertPublicUpstream(url: URL): Promise<void> {
    const hostname = bareHostname(url);
    if (!isPublicHttpsUrl(url)) {
      throw new PrivateUpstreamError(hostname, "the URL is not https or names a private host");
    }
    const addresses = await lookup(hostname, { all: true });
    if (addresses.some(({ address }) => isPrivateAddress(address))) {
      throw new PrivateUpstreamError(
        hostname,
        "it resolves to a loopback, private or link-local address",
      );
    }
  }
}
