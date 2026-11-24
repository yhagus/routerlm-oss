import { lookup } from "node:dns/promises";
import { Injectable } from "@nestjs/common";
import { allowsPrivateUpstreams } from "@/libs/models/private-upstreams-policy.js";
import { bareHostname } from "@/libs/models/url.js";
import { isPrivateAddress, isPublicHttpsUrl } from "@/libs/schemas/provider-url.schema.js";

export class PrivateUpstreamError extends Error {
  constructor(hostname: string, reason: string) {
    super(
      `Refused to connect to ${hostname}: ${reason} (turn on Allow private upstreams in Settings to allow it)`,
    );
  }
}

function urlOf(input: Parameters<typeof fetch>[0]): URL {
  return new URL(input instanceof Request ? input.url : input);
}

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
