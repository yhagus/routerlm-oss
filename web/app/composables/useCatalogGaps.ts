import { CATALOG_GAPS_PATH, type CatalogGap, type CatalogGapsResponse } from "~/lib/catalogGaps";

const CHECKED_STORAGE_KEY = "catalog-gaps-checked";

/**
 * The new models (Catalog Gaps) found once per browser session, for the layout
 * to announce. A failed check shows nothing: the notice is a courtesy, not a page.
 */
export function useCatalogGaps() {
  const gaps = useState<CatalogGap[]>("catalog-gaps", () => []);
  const { $dashboardApi } = useNuxtApp();

  async function checkOncePerSession(): Promise<void> {
    if (sessionStorage.getItem(CHECKED_STORAGE_KEY)) return;
    sessionStorage.setItem(CHECKED_STORAGE_KEY, "true");
    try {
      const response = await $dashboardApi<CatalogGapsResponse>(CATALOG_GAPS_PATH);
      gaps.value = response.gaps;
    } catch {
      gaps.value = [];
    }
  }

  function dismiss(): void {
    gaps.value = [];
  }

  return { gaps, checkOncePerSession, dismiss };
}
