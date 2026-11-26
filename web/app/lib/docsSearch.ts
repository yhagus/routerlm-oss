export interface Section {
  id: string;
  title: string;
  titles: string[];
  level: number;
  content: string;
}

const MAX_MATCHES = 20;
const SNIPPET_BEFORE = 40;
const SNIPPET_AFTER = 90;

export interface SearchSnippet {
  before: string;
  match: string;
  after: string;
}

export interface SearchRow {
  kind: 'page' | 'section';
  to: string;
  title: string;
  pageNumber?: number;
  isMatch: boolean;
  snippet: SearchSnippet | null;
}

export function normalizeText(text: string): string {
  return text
    .replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, '$1 $2')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export function searchTermsOf(query: string): string[] {
  return normalizeText(query).split(' ').filter(Boolean);
}

const RELATED_WORDS: readonly (readonly string[])[] = [
  ['tier', 'priority', 'fast', 'flex', 'speed', 'latency'],
  [
    'key',
    'apikey',
    'token',
    'bearer',
    'credential',
    'authentication',
    'authorization',
    'secret',
    'kunci',
  ],
  ['limit', 'quota', 'throttle', 'throttling', 'ratelimit', '429'],
  ['stream', 'streaming', 'sse', 'events', 'chunk', 'delta'],
  ['image', 'images', 'vision', 'photo', 'picture', 'base64', 'gambar'],
  ['tool', 'tools', 'function', 'functions', 'alat', 'fungsi'],
  ['error', 'errors', 'failure', 'failed', 'status', 'galat', 'gagal'],
  ['retry', 'retries', 'backoff', 'fallback', 'ulang', 'percobaan'],
  ['reasoning', 'thinking', 'effort'],
  ['json', 'schema', 'structured', 'terstruktur'],
  ['model', 'models', 'capability', 'capabilities'],
  ['cache', 'caching', 'cached'],
  ['timeout', 'slow', '504'],
  ['size', 'large', '413', 'mb', 'ukuran'],
];

const RELATED_BY_WORD = new Map<string, readonly string[]>();
for (const group of RELATED_WORDS) {
  for (const word of group) {
    RELATED_BY_WORD.set(word, [
      ...(RELATED_BY_WORD.get(word) ?? []),
      ...group.filter((other) => other !== word),
    ]);
  }
}

type Strength = 0 | 1 | 2 | 3 | 4;

function withinEdits(first: string, second: string, maxEdits: number): boolean {
  if (Math.abs(first.length - second.length) > maxEdits) return false;
  let previous = Array.from({ length: second.length + 1 }, (_, index) => index);
  for (let row = 1; row <= first.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= second.length; column += 1) {
      const cost = first[row - 1] === second[column - 1] ? 0 : 1;
      current[column] = Math.min(
        (previous[column] ?? 0) + 1,
        (current[column - 1] ?? 0) + 1,
        (previous[column - 1] ?? 0) + cost,
      );
    }
    previous = current;
  }
  return (previous[second.length] ?? Infinity) <= maxEdits;
}

function literalStrength(term: string, word: string): Strength {
  if (word === term) return 4;
  if (term.length >= 2 && word.startsWith(term)) return 3;
  if (term.length >= 3 && word.includes(term)) return 2;
  return 0;
}

function isTypoOf(term: string, word: string): boolean {
  if (term.length < 4 || (term.length === 4 && term[0] !== word[0])) return false;
  return withinEdits(term, word, term.length >= 9 ? 2 : 1);
}

function strengthOf(term: string, word: string): Strength {
  const literal = literalStrength(term, word);
  if (literal > 0) return literal;
  const related = RELATED_BY_WORD.get(term) ?? [];
  if (related.some((other) => literalStrength(other, word) >= 3)) return 2;
  return isTypoOf(term, word) ? 1 : 0;
}

function bestStrengthIn(term: string, words: readonly string[]): Strength {
  let best: Strength = 0;
  for (const word of words) {
    const strength = strengthOf(term, word);
    if (strength > best) best = strength;
    if (best === 4) break;
  }
  return best;
}

const wordsOfSection = new WeakMap<Section, { title: string[]; text: string[] }>();
function wordsOf(section: Section): { title: string[]; text: string[] } {
  const known = wordsOfSection.get(section);
  if (known) return known;
  const words = {
    title: normalizeText(section.title).split(' ').filter(Boolean),
    text: normalizeText(section.content).split(' ').filter(Boolean),
  };
  wordsOfSection.set(section, words);
  return words;
}

const TITLE_WEIGHT = 3;

function scoresOf(section: Section, terms: string[]): number[] {
  const { title, text } = wordsOf(section);
  return terms.map(
    (term) => bestStrengthIn(term, text) + TITLE_WEIGHT * bestStrengthIn(term, title),
  );
}

function snippetOf(content: string, terms: string[]): SearchSnippet | null {
  const spans = [...content.matchAll(/[\p{L}\p{N}_]+/gu)];
  const bestSpan = (minimum: Strength) =>
    spans.find((span) => {
      const subwords = normalizeText(span[0]).split(' ').filter(Boolean);
      return terms.some((term) => subwords.some((word) => strengthOf(term, word) >= minimum));
    });
  const span = bestSpan(2) ?? bestSpan(1);
  if (!span) return null;
  const start = span.index;
  const end = start + span[0].length;
  const from = Math.max(0, start - SNIPPET_BEFORE);
  const to = Math.min(content.length, end + SNIPPET_AFTER);
  return {
    before: (from > 0 ? '…' : '') + content.slice(from, start),
    match: content.slice(start, end),
    after: content.slice(end, to) + (to < content.length ? '…' : ''),
  };
}

function pagePathOf(sectionId: string): string {
  return sectionId.split('#')[0] ?? sectionId;
}

export function searchSections(
  sections: Section[],
  query: string,
  pageNumberOf: (path: string) => number | undefined,
): SearchRow[] {
  const terms = searchTermsOf(query);
  if (terms.length === 0) return [];

  const scored = sections.map((section) => ({ section, scores: scoresOf(section, terms) }));
  let found = scored.filter(({ scores }) => scores.every((score) => score > 0));
  if (found.length === 0 && terms.length > 1) {
    found = scored.filter(({ scores }) => scores.some((score) => score > 0));
  }
  const matches = found
    .map(({ section, scores }) => ({
      section,
      termsMatched: scores.filter((score) => score > 0).length,
      total: scores.reduce((sum, score) => sum + score, 0),
    }))
    .sort((first, second) => second.termsMatched - first.termsMatched || second.total - first.total)
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
      kind: 'page',
      to: pagePath,
      title: pageTitles.get(pagePath) ?? pageMatches[0]?.titles[0] ?? pagePath,
      pageNumber: pageNumberOf(pagePath),
      isMatch: pageMatch !== undefined,
      snippet: pageMatch ? snippetOf(pageMatch.content, terms) : null,
    };
    const sectionRows = pageMatches
      .filter((section) => section.level > 1)
      .map((section): SearchRow => ({
        kind: 'section',
        to: section.id,
        title: section.title,
        isMatch: true,
        snippet: snippetOf(section.content, terms),
      }));
    return [pageRow, ...sectionRows];
  });
}

export function firstMatchIndexOf(rows: SearchRow[]): number {
  return Math.max(
    0,
    rows.findIndex((row) => row.isMatch),
  );
}
