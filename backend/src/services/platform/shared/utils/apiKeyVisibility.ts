/** Only explicit "public" is public; null/undefined/empty/anything else → private. */
export function normalizeApiKeyVisibility(value: any) {
  return value === "public" ? "public" : "private";
}

export function isApiKeyPublic(keyOrVisibility: any) {
  if (keyOrVisibility && typeof keyOrVisibility === "object") {
    return normalizeApiKeyVisibility(keyOrVisibility.visibility) === "public";
  }
  return normalizeApiKeyVisibility(keyOrVisibility) === "public";
}
