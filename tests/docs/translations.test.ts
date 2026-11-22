import { CATALOG_DIRECTORY, loadCatalog } from "@/catalog/models/load-catalog.js";
import {
  codeBlocksOf,
  type DocsPage,
  DOCS_ID_DIRECTORY,
  proseOf,
  readDocsPages,
} from "@tests/support/docs-examples.js";

// The Indonesian pages translate the prose only. Their examples must stay the
// examples client-examples.test.ts runs, so a translation can't drift from
// what the gateway does.

const englishPages = readDocsPages();
const indonesianPages = readDocsPages(DOCS_ID_DIRECTORY);

function examplesOf(page: DocsPage): { language: string; code: string }[] {
  return codeBlocksOf(page).map(({ language, code }) => ({ language, code }));
}

/** The `::code-tabs` and closing `::` lines, which group the examples into tabs. */
function blockMarkersOf(page: DocsPage): string[] {
  return page.markdown.split("\n").filter((line) => line.startsWith("::"));
}

function iconOf(page: DocsPage): string | undefined {
  return /^icon:\s*(\S+)\s*$/m.exec(page.markdown)?.[1];
}

describe("Indonesian client documentation", () => {
  it("translates every English page and adds none", () => {
    expect(indonesianPages.map((page) => page.fileName)).toEqual(
      englishPages.map((page) => page.fileName),
    );
  });

  describe.each(englishPages.map((page) => [page.fileName, page] as const))(
    "%s",
    (fileName, english) => {
      const indonesian = indonesianPages.find((page) => page.fileName === fileName);

      it("keeps the English examples, unchanged and in order", () => {
        expect(indonesian && examplesOf(indonesian)).toEqual(examplesOf(english));
      });

      it("groups the examples into the same tabs", () => {
        expect(indonesian && blockMarkersOf(indonesian)).toEqual(blockMarkersOf(english));
      });

      it("keeps the page's icon", () => {
        expect(indonesian && iconOf(indonesian)).toBe(iconOf(english));
      });

      it("links to Indonesian pages", () => {
        expect(indonesian?.markdown).not.toMatch(/\]\(\/docs(\/|\)|#)/);
      });
    },
  );

  it("names no Provider in prose", async () => {
    const providerNames = (await loadCatalog(CATALOG_DIRECTORY)).map((provider) => provider.name);
    const named = indonesianPages.flatMap((page) => {
      const prose = proseOf(page).toLowerCase();
      return providerNames
        .filter((name) => prose.includes(name.toLowerCase()))
        .map((name) => `${page.fileName}: ${name}`);
    });
    expect(named).toEqual([]);
  });
});
