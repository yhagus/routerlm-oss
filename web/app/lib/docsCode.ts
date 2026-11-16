/** One fenced code block of a docs page, as written in its Markdown. */
export interface CodeExample {
  /** The fence's language: `bash`, `ts`, `json`, or empty. */
  language: string;
  code: string;
}

/** The package an example imports first, e.g. `openai` or `@anthropic-ai/sdk`. */
function importedPackageOf(code: string): string | undefined {
  return /^import\b[^;]*?from\s+["']([^"']+)["']/m.exec(code)?.[1];
}

/** What a code block's header (or its tab) calls it. */
export function labelOf({ language, code }: CodeExample): string {
  if (language === "bash") return code.trimStart().startsWith("curl") ? "curl" : "Shell";
  if (language === "ts") {
    const sdk = importedPackageOf(code);
    return sdk ? `TypeScript · ${sdk}` : "TypeScript";
  }
  if (language === "json") return "JSON";
  return language || "Text";
}

/**
 * A docs page's Markdown as a reader would paste it into a chat or an agent:
 * no frontmatter and no MDC wrappers (the `::code-tabs` lines and the `::`
 * that closes them). Fenced code is left as written.
 */
export function readableMarkdownOf(rawMarkdown: string): string {
  return rawMarkdown
    .replace(/^---\n[\s\S]*?\n---\n+/, "")
    .replace(/^::(code-tabs)?[ \t]*\n/gm, "")
    .trim()
    .concat("\n");
}
