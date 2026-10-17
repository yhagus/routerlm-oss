// Port of v1 src/shared/utils/bulkAdd.js — plan collision-free "<base> <n>"
// names for bulk API-key adds (the backend upserts apikey connections by name,
// so a generated name must never collide with an existing one).

export interface BulkAddEntry {
  name: string;
  apiKey: string;
  skipped: boolean;
}

interface ParsedLine {
  baseName: string;
  apiKey: string;
}

function parseLine(line: string): ParsedLine | null {
  const parts = line.split("|");

  if (parts.length >= 2) {
    const baseName = parts[0].trim();
    const apiKey = parts.slice(1).join("|").trim();
    return { baseName: baseName || "Key", apiKey };
  }

  return { baseName: "Key", apiKey: parts[0].trim() };
}

export function planBulkAdd(
  lines: string[],
  existingNames: string[],
): BulkAddEntry[] {
  const used = new Set(
    existingNames
      .filter((name) => typeof name === "string")
      .map((name) => name.toLowerCase()),
  );
  const out: BulkAddEntry[] = [];

  for (const raw of lines) {
    const line = typeof raw === "string" ? raw.trim() : "";
    if (!line) continue;

    const parsed = parseLine(line);
    if (!parsed?.apiKey) continue;

    let index = 1;
    let name = "";
    for (;;) {
      name = `${parsed.baseName} ${index}`;
      if (!used.has(name.toLowerCase())) break;
      index += 1;
    }
    used.add(name.toLowerCase());

    out.push({
      name,
      apiKey: parsed.apiKey,
      skipped: false,
    });
  }
  return out;
}
