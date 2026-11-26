export interface CatalogGap {
  providerSlug: string;
  providerName: string;
  upstreamModelId: string;
  name: string;
  releaseDate: string | null;
}

export interface CatalogGapsResponse {
  checkedAt: string | null;
  gaps: CatalogGap[];
}

export const CATALOG_GAPS_PATH = '/catalog/gaps';

export const MAX_LISTED_GAPS = 5;

export function describeCatalogGap(gap: CatalogGap): string {
  const label = `${gap.providerName} · ${gap.upstreamModelId}`;
  return gap.releaseDate ? `${label} (${gap.releaseDate})` : label;
}
