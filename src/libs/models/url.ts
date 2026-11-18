const TRAILING_SLASH = /\/$/;

/** The URL without its trailing slash, so a path can be appended with one. */
export function withoutTrailingSlash(url: string): string {
  return url.replace(TRAILING_SLASH, "");
}

const IPV6_BRACKETS = /^\[|\]$/g;

/** The URL's host without the brackets `URL` keeps around an IPv6 literal. */
export function bareHostname(url: URL): string {
  return url.hostname.replace(IPV6_BRACKETS, "");
}
