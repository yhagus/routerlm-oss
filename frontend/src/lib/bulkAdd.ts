// Port of v1 src/shared/utils/bulkAdd.js — plan collision-free "<base> <n>"
// names for bulk API-key adds (the backend upserts apikey connections by name,
// so a generated name must never collide with an existing one).

export interface BulkAddEntry {
  name: string;
  apiKey: string;
  refreshToken?: string;
  clientId?: string;
  skipped: boolean;
}

interface ParsedLine {
  baseName: string;
  apiKey: string;
  refreshToken?: string;
  clientId?: string;
}

function parseSession(value: string | undefined): Pick<ParsedLine, "refreshToken" | "clientId"> {
  const separator = value?.indexOf(":") ?? -1;
  if (separator < 1) return {};
  const refreshToken = value!.slice(0, separator).trim();
  const clientId = value!.slice(separator + 1).trim();
  if (!refreshToken || !clientId) return {};
  return { refreshToken, clientId };
}

function parseLine(line: string): ParsedLine | null {
  const parts = line.split("|");

  if (parts.length >= 2) {
    const baseName = parts[0].trim();
    const apiKey = parts[1].trim();
    return { baseName: baseName || "Key", apiKey, ...parseSession(parts[2]) };
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
      refreshToken: parsed.refreshToken,
      clientId: parsed.clientId,
      skipped: false,
    });
  }
  return out;
}
