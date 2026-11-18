import { isIPv4, isIPv6 } from "node:net";
import { z } from "zod";
import { envSchema } from "@/config/schemas/env.schema.js";

/** [first, second octet] of the network and its prefix length; every prefix is at most 16 bits. */
const NON_PUBLIC_IPV4_RANGES: readonly (readonly [number, number, number])[] = [
  [0, 0, 8],
  [10, 0, 8],
  [127, 0, 8],
  [169, 254, 16],
  [172, 16, 12],
  [192, 168, 16],
];

function isPrivateIpv4(address: string): boolean {
  const [first, second] = address.split(".").map(Number);
  const prefix = first * 256 + second;
  return NON_PUBLIC_IPV4_RANGES.some(([networkFirst, networkSecond, bits]) => {
    const shift = 16 - bits;
    return prefix >> shift === (networkFirst * 256 + networkSecond) >> shift;
  });
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
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (isIPv4(host)) return isPrivateIpv4(host);
  if (isIPv6(host)) return isPrivateIpv6(host);
  return false;
}

/**
 * Read on every parse, from the process environment, because the schemas that
 * use it are module constants. The deploy-time variable is not a Setting, so a
 * hijacked session cannot turn the rule off (ADR 0019).
 */
function allowsPrivateUpstreams(): boolean {
  return envSchema.shape.ALLOW_PRIVATE_UPSTREAMS.parse(process.env.ALLOW_PRIVATE_UPSTREAMS);
}

/**
 * A URL the gateway sends a credential to: https and not a loopback, private
 * or link-local literal, unless `ALLOW_PRIVATE_UPSTREAMS` lifts both rules.
 */
export const providerUrlSchema = z.url().check(
  z.refine(
    (value) => {
      if (allowsPrivateUpstreams()) return true;
      const url = new URL(value);
      return url.protocol === "https:" && !hasPrivateHost(url);
    },
    {
      error:
        "Must be an https URL that is not localhost, loopback, private or link-local (set ALLOW_PRIVATE_UPSTREAMS=true to allow them)",
    },
  ),
);
