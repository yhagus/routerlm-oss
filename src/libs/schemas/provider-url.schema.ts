import { isIPv4, isIPv6 } from "node:net";
import { z } from "zod";
import { envSchema } from "@/config/schemas/env.schema.js";
import { bareHostname } from "../models/url.js";

/** A network by its first two octets and prefix length; every prefix is at most 16 bits. */
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

/** Whether an IP address literal is loopback, private or link-local. */
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

/** `new URL` writes `::ffff:127.0.0.1` as `::ffff:7f00:1`. */
function isPrivateMappedIpv4(lower: string): boolean {
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(lower);
  if (!mapped) return false;
  const high = Number.parseInt(mapped[1], 16);
  const low = Number.parseInt(mapped[2], 16);
  return isPrivateIpv4(`${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`);
}

/** Whether the URL's host is `localhost` or a loopback, private or link-local address literal. */
function hasPrivateHost(url: URL): boolean {
  const host = bareHostname(url).toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  return (isIPv4(host) || isIPv6(host)) && isPrivateAddress(host);
}

/**
 * Read on every parse, from the process environment, because the schemas that
 * use it are module constants. The deploy-time variable is not a Setting, so a
 * hijacked session cannot turn the rule off (ADR 0019).
 */
export function allowsPrivateUpstreams(): boolean {
  return envSchema.shape.ALLOW_PRIVATE_UPSTREAMS.parse(process.env.ALLOW_PRIVATE_UPSTREAMS);
}

/** Whether the URL is https and its host is not a `localhost` or a private address literal. */
export function isPublicHttpsUrl(url: URL): boolean {
  return url.protocol === "https:" && !hasPrivateHost(url);
}

/**
 * A URL the gateway sends a credential to: https and not a loopback, private
 * or link-local literal, unless `ALLOW_PRIVATE_UPSTREAMS` lifts both rules.
 */
export const providerUrlSchema = z.url().check(
  z.refine((value) => allowsPrivateUpstreams() || isPublicHttpsUrl(new URL(value)), {
    error:
      "Must be an https URL that is not localhost, loopback, private or link-local (set ALLOW_PRIVATE_UPSTREAMS=true to allow them)",
  }),
);
