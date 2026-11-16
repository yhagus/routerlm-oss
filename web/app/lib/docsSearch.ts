/**
 * A heading's section of a docs page, as @nuxt/content's
 * queryCollectionSearchSections returns it (its `Section` type isn't exported).
 */
export interface Section {
  /** The page path, with the heading's hash for a heading below the h1. */
  id: string;
  title: string;
  /** The titles of the headings above it, from the page title down. */
  titles: string[];
  /** 1 for the page itself (its h1 and intro), 2 for an h2, and so on. */
  level: number;
  content: string;
}

/** The most sections a search lists, before grouping them by page. */
const MAX_MATCHES = 20;
/** How much text a snippet keeps on each side of the matched term. */
const SNIPPET_BEFORE = 40;
const SNIPPET_AFTER = 90;

/** A line of section text cut around a match, with the matched term apart so it can be marked. */
export interface SearchSnippet {
  before: string;
  match: string;
  after: string;
}

/** One row of the search results: a page, or a section of the page above it. */
export interface SearchRow {
  kind: "page" | "section";
  /** The address to go to, with the section's hash for a section. */
  to: string;
  title: string;
  /** The page's number in the contents; set on page rows. */
  pageNumber?: number;
  /** False for a page row listed only as the heading of its matching sections. */
  isMatch: boolean;
  snippet: SearchSnippet | null;
}

/** The terms of a query: its lowercased, whitespace-separated words. */
export function searchTermsOf(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

function snippetOf(content: string, terms: string[]): SearchSnippet | null {
  const lowerContent = content.toLowerCase();
  for (const term of terms) {
    const start = lowerContent.indexOf(term);
    if (start === -1) continue;
    const end = start + term.length;
    const from = Math.max(0, start - SNIPPET_BEFORE);
    const to = Math.min(content.length, end + SNIPPET_AFTER);
    return {
      before: (from > 0 ? "…" : "") + content.slice(from, start),
      match: content.slice(start, end),
      after: content.slice(end, to) + (to < content.length ? "…" : ""),
    };
  }
  return null;
}

function pagePathOf(sectionId: string): string {
  return sectionId.split("#")[0] ?? sectionId;
}

/**
 * The sections holding every term of the query, in their title or their text,
 * as rows grouped under their page: sections whose title holds more terms
 * come first, and the pages follow the order of their best section.
 */
export function searchSections(
  sections: Section[],
  query: string,
  pageNumberOf: (path: string) => number | undefined,
): SearchRow[] {
  const terms = searchTermsOf(query);
  if (terms.length === 0) return [];

  const titleHitsOf = (section: Section): number =>
    terms.filter((term) => section.title.toLowerCase().includes(term)).length;
  const matches = sections
    .filter((section) => {
      const text = `${section.title} ${section.content}`.toLowerCase();
      return terms.every((term) => text.includes(term));
    })
    .map((section) => ({ section, titleHits: titleHitsOf(section) }))
    .sort((first, second) => second.titleHits - first.titleHits)
    .slice(0, MAX_MATCHES)
    .map(({ section }) => section);

  const pageTitles = new Map(
    sections.filter((section) => section.level === 1).map((page) => [page.id, page.title]),
  );
  const matchesByPage = new Map<string, Section[]>();
  for (const section of matches) {
    const pagePath = pagePathOf(section.id);
    matchesByPage.set(pagePath, [...(matchesByPage.get(pagePath) ?? []), section]);
  }

  return [...matchesByPage].flatMap(([pagePath, pageMatches]) => {
    const pageMatch = pageMatches.find((section) => section.level === 1);
    const pageRow: SearchRow = {
      kind: "page",
      to: pagePath,
      title: pageTitles.get(pagePath) ?? pageMatches[0]?.titles[0] ?? pagePath,
      pageNumber: pageNumberOf(pagePath),
      isMatch: pageMatch !== undefined,
      snippet: pageMatch ? snippetOf(pageMatch.content, terms) : null,
    };
    const sectionRows = pageMatches
      .filter((section) => section.level > 1)
      .map((section): SearchRow => ({
        kind: "section",
        to: section.id,
        title: section.title,
        isMatch: true,
        snippet: snippetOf(section.content, terms),
      }));
    return [pageRow, ...sectionRows];
  });
}

/**
 * The row to highlight first: the first one that matched, so a page listed
 * only for its sections hands Enter to its best section, not to its top.
 */
export function firstMatchIndexOf(rows: SearchRow[]): number {
  return Math.max(
    0,
    rows.findIndex((row) => row.isMatch),
  );
}
