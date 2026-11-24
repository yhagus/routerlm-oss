export interface CodeExample {
  language: string;
  code: string;
}

function importedPackageOf(code: string): string | undefined {
  return /^import\b[^;]*?from\s+["']([^"']+)["']/m.exec(code)?.[1];
}

export function labelOf({ language, code }: CodeExample): string {
  if (language === "bash") return code.trimStart().startsWith("curl") ? "curl" : "Shell";
  if (language === "ts") {
    const sdk = importedPackageOf(code);
    return sdk ? `TypeScript · ${sdk}` : "TypeScript";
  }
  if (language === "json") return "JSON";
  return language || "Text";
}

export function readableMarkdownOf(rawMarkdown: string): string {
  return rawMarkdown
    .replace(/^---\n[\s\S]*?\n---\n+/, "")
    .replace(/^::(code-tabs)?[ \t]*\n/gm, "")
    .trim()
    .concat("\n");
}
