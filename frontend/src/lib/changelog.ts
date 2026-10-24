export interface ChangelogSection {
  // "1.4.0" for "# v1.4.0 (2026-10-24)", or the raw title such as "Unreleased".
  version: string;
  date: string | null;
  body: string;
}

const VERSION_HEADING = /^v?(\d+\.\d+\.\d+\S*)(?:\s+\(([^)]+)\))?$/;

// Splits CHANGELOG.md on its top-level "# " headings, newest first.
export function parseChangelog(markdown: string): ChangelogSection[] {
  const sections: ChangelogSection[] = [];
  let current: ChangelogSection | null = null;
  let lines: string[] = [];
  const flush = () => {
    if (current) sections.push({ ...current, body: lines.join("\n").trim() });
  };
  for (const line of markdown.split(/\r?\n/)) {
    if (line.startsWith("# ")) {
      flush();
      const title = line.slice(2).trim();
      const match = title.match(VERSION_HEADING);
      current = match
        ? { version: match[1], date: match[2] || null, body: "" }
        : { version: title, date: null, body: "" };
      lines = [];
    } else if (current) lines.push(line);
  }
  flush();
  return sections;
}

export function changelogSection(
  sections: ChangelogSection[],
  version: string | null | undefined,
): ChangelogSection | null {
  if (!version) return null;
  const wanted = version.replace(/^v/, "");
  return sections.find((section) => section.version === wanted) || null;
}

const SEEN_KEY = "lobakai-changelog-seen";

export function seenChangelogVersion(): string | null {
  try {
    return localStorage.getItem(SEEN_KEY);
  } catch {
    return null;
  }
}

export function markChangelogSeen(version: string): void {
  try {
    localStorage.setItem(SEEN_KEY, version);
  } catch {
    /* Without storage the button shows again on the next load. */
  }
}
