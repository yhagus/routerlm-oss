import { isIPv4, isIPv6 } from "node:net";
import { z } from "zod";
import { allowsPrivateUpstreams } from "@/libs/models/private-upstreams-policy";
import { bareHostname } from "@/libs/models/url";

interface Ipv4Range {
  firstOctet: number;
  secondOctet: number;
  prefixBits: number;
}

const NON_PUBLIC_IPV4_RANGES: readonly Ipv4Range[] = [
  { firstOctet: 0, secondOctet: 0, prefixBits: 8 },
  { firstOctet: 10, secondOctet: 0, prefixBits: 8 },
  { firstOctet: 127, secondOctet: 0, prefixBits: 8 },
  { firstOctet: 169, secondOctet: 254, prefixBits: 16 },
  { firstOctet: 172, secondOctet: 16, prefixBits: 12 },
  { firstOctet: 192, secondOctet: 168, prefixBits: 16 },
];

function isPrivateIpv4(address: string): boolean {
  const [first, second] = address.split(".").map(Number);
  const prefix = first * 256 + second;
  return NON_PUBLIC_IPV4_RANGES.some(({ firstOctet, secondOctet, prefixBits }) => {
    const shift = 16 - prefixBits;
    return prefix >> shift === (firstOctet * 256 + secondOctet) >> shift;
  });
}

export function isPrivateAddress(address: string): boolean {
  return isIPv4(address) ? isPrivateIpv4(address) : isPrivateIpv6(address);
}

function isPrivateIpv6(address: string): boolean {
  const lower = address.toLowerCase();
  if (lower === "::" || lower === "::1") return true;
  const firstGroup = Number.parseInt(lower.split(":")[0] || "0", 16);
  const isUniqueLocal = (firstGroup & 0xfe00) === 0xfc00;
  const isLinkLocal = (firstGroup & 0xffc0) === 0xfe80;
  if (isUniqueLocal || isLinkLocal) return true;
  return isPrivateMappedIpv4(lower);
}

function isPrivateMappedIpv4(lower: string): boolean {
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(lower);
  if (!mapped) return false;
  const high = Number.parseInt(mapped[1], 16);
  const low = Number.parseInt(mapped[2], 16);
  return isPrivateIpv4(`${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`);
}

function hasPrivateHost(url: URL): boolean {
  const host = bareHostname(url).toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  return (isIPv4(host) || isIPv6(host)) && isPrivateAddress(host);
}

export function isPublicHttpsUrl(url: URL): boolean {
  return url.protocol === "https:" && !hasPrivateHost(url);
}

export const providerUrlSchema = z.url().check(
  z.refine((value) => allowsPrivateUpstreams() || isPublicHttpsUrl(new URL(value)), {
    error:
      "Must be an https URL that is not localhost, loopback, private or link-local (turn on Allow private upstreams in Settings to allow them)",
  }),
);
