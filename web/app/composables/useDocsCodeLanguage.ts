import type { Ref } from "vue";

const STORAGE_KEY = "routerlm-docs-code-language";

function readStoredLanguage(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * The code language the reader last picked in a docs tab group (a fence
 * language such as `bash` or `ts`). Every tab group on every page follows it,
 * and it is remembered across visits when the browser allows storage.
 */
export function useDocsCodeLanguage(): {
  preferredLanguage: Readonly<Ref<string | null>>;
  choose: (language: string) => void;
} {
  const preferredLanguage = useState<string | null>("docs-code-language", readStoredLanguage);

  function choose(language: string): void {
    preferredLanguage.value = language;
    try {
      localStorage.setItem(STORAGE_KEY, language);
    } catch {
      // Storage is blocked (private mode, site data off): the choice lasts this visit.
    }
  }

  return { preferredLanguage, choose };
}
