/** An Upstream Model that models.dev lists among a Provider's newest, but the Catalog does not hold. */
export interface CatalogGap {
  providerSlug: string;
  providerName: string;
  upstreamModelId: string;
  name: string;
  releaseDate: string;
}

/** `checkedAt` is when models.dev was last read; null when it could not be reached. */
export interface CatalogGapReport {
  checkedAt: Date | null;
  gaps: CatalogGap[];
}
