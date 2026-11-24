import type { Ref } from "vue";

const STORAGE_KEY = "routerlm-docs-code-language";

function readStoredLanguage(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function useDocsCodeLanguage(): {
  preferredLanguage: Readonly<Ref<string | null>>;
  choose: (language: string) => void;
} {
  const preferredLanguage = useState<string | null>("docs-code-language", readStoredLanguage);

  function choose(language: string): void {
    preferredLanguage.value = language;
    try {
      localStorage.setItem(STORAGE_KEY, language);
    } catch {}
  }

  return { preferredLanguage, choose };
}
