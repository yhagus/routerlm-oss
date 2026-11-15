const TRAILING_SLASH = /\/$/;

/** The URL without its trailing slash, so a path can be appended with one. */
export function withoutTrailingSlash(url: string): string {
  return url.replace(TRAILING_SLASH, "");
}
