import { lookup } from "node:dns/promises";
import { Injectable } from "@nestjs/common";
import { allowsPrivateUpstreams, isPrivateAddress } from "../schemas/provider-url.schema.js";

/** Thrown before any connection is made, so no credential leaves the gateway. */
export class PrivateUpstreamError extends Error {
  constructor(hostname: string) {
    super(
      `Refused to connect to ${hostname}: it resolves to a loopback, private or link-local address (set ALLOW_PRIVATE_UPSTREAMS=true to allow it)`,
    );
  }
}

function hostnameOf(input: Parameters<typeof fetch>[0]): string {
  const url = new URL(input instanceof Request ? input.url : input);
  return url.hostname.replace(/^\[|\]$/g, "");
}

/**
 * The `fetch` of every client that sends a Provider's credential: it resolves
 * the host and refuses a private result unless the deployment allows private
 * upstreams (ADR 0019). A public-looking name that resolves privately, or that
 * changes later (DNS rebinding), is caught here and not by the write-time schema.
 * The connection resolves the name again, so a rebind in the milliseconds between
 * the check and the connect is not covered.
 */
@Injectable()
export class OutboundFetch {
  readonly fetch: typeof globalThis.fetch = async (input, init) => {
    if (!allowsPrivateUpstreams()) {
      await this.assertPublicHost(hostnameOf(input));
    }
    return globalThis.fetch(input, init);
  };

  private async assertPublicHost(hostname: string): Promise<void> {
    const addresses = await lookup(hostname, { all: true });
    if (addresses.some(({ address }) => isPrivateAddress(address))) {
      throw new PrivateUpstreamError(hostname);
    }
  }
}
