const TRAILING_SLASH = /\/$/;

export function withoutTrailingSlash(url: string): string {
  return url.replace(TRAILING_SLASH, '');
}

const IPV6_BRACKETS = /^\[|\]$/g;

export function bareHostname(url: URL): string {
  return url.hostname.replace(IPV6_BRACKETS, '');
}
