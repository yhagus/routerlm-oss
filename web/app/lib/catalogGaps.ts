// Catalog Gaps: models the public models.dev listing has that the Catalog doesn't, as the dashboard API returns them.

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

export const CATALOG_GAPS_PATH = "/catalog/gaps";

/** How many gaps the notice lists before it folds the rest into "and N more". */
export const MAX_LISTED_GAPS = 5;

export function describeCatalogGap(gap: CatalogGap): string {
  const label = `${gap.providerName} · ${gap.upstreamModelId}`;
  return gap.releaseDate ? `${label} (${gap.releaseDate})` : label;
}
