export interface CatalogGap {
  providerSlug: string;
  providerName: string;
  upstreamModelId: string;
  name: string;
  releaseDate: string;
}

export interface CatalogGapReport {
  checkedAt: Date | null;
  gaps: CatalogGap[];
}
