import { describe, expect, test } from "vitest";
import { changelogSection, parseChangelog } from "./changelog";

const sample = `# Unreleased

- Pending item.

# v1.4.0 (2026-10-24)

## Providers

- Removed a provider.

# v1.3.0

- Older item.
`;

describe("parseChangelog", () => {
  test("splits on top-level headings and reads version and date", () => {
    const sections = parseChangelog(sample);
    expect(sections.map((s) => [s.version, s.date])).toEqual([
      ["Unreleased", null],
      ["1.4.0", "2026-10-24"],
      ["1.3.0", null],
    ]);
    expect(sections[1].body).toBe("## Providers\n\n- Removed a provider.");
  });
});

describe("changelogSection", () => {
  const sections = parseChangelog(sample);

  test("finds a version with or without the v prefix", () => {
    expect(changelogSection(sections, "1.4.0")?.date).toBe("2026-10-24");
    expect(changelogSection(sections, "v1.3.0")?.body).toBe("- Older item.");
  });

  test("returns null for a version without an entry", () => {
    expect(changelogSection(sections, "9.9.9")).toBeNull();
    expect(changelogSection(sections, null)).toBeNull();
  });
});
