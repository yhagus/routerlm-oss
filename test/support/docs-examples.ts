import { readdirSync, readFileSync } from "node:fs";

/** The client documentation's Markdown pages, as the web app serves them at /docs. */
export const DOCS_DIRECTORY = new URL("../../web/content/docs/", import.meta.url);

/** The placeholders every example uses, so a reader knows what to substitute. */
export const DOCS_BASE_URL = "https://gateway.example.com";
export const DOCS_MODEL_NAME = "my-model";
export const DOCS_API_KEY_VARIABLE = "ROUTERLM_API_KEY";

export interface DocsPage {
  fileName: string;
  markdown: string;
}

/** One fenced code block of a docs page. */
export interface CodeBlock {
  fileName: string;
  /** 1-based position among the page's code blocks, to name the example in test output. */
  position: number;
  language: string;
  code: string;
}

/** An HTTP request a documented curl command sends. */
export interface CurlRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string | undefined;
}

export function readDocsPages(): DocsPage[] {
  return readdirSync(DOCS_DIRECTORY)
    .filter((fileName) => fileName.endsWith(".md"))
    .sort()
    .map((fileName) => ({
      fileName,
      markdown: readFileSync(new URL(fileName, DOCS_DIRECTORY), "utf8"),
    }));
}

const FENCED_BLOCK = /^```(\w*)[^\n]*\n([\s\S]*?)^```$/gm;

export function codeBlocksOf(page: DocsPage): CodeBlock[] {
  return [...page.markdown.matchAll(FENCED_BLOCK)].map((match, index) => ({
    fileName: page.fileName,
    position: index + 1,
    language: match[1],
    code: match[2],
  }));
}

/** The page's prose: everything outside fenced blocks and inline code. */
export function proseOf(page: DocsPage): string {
  return page.markdown.replace(FENCED_BLOCK, "").replace(/`[^`\n]*`/g, "");
}

/**
 * Reads a curl command the way a POSIX shell would, for the subset the docs
 * use: line continuations, single and double quotes, `$VARIABLE` expansion
 * outside single quotes, and the options -H, -d, -X and -N. Anything else
 * throws, so an example can't silently rely on something this doesn't run.
 */
export function parseCurl(command: string, variables: Record<string, string>): CurlRequest {
  const [program, ...args] = shellWords(command, variables);
  if (program !== "curl") {
    throw new Error(`Expected a curl command, got "${program}"`);
  }

  const request: CurlRequest = { method: "GET", url: "", headers: {}, body: undefined };
  let explicitMethod: string | undefined;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "-H") {
      const [name, ...value] = args[++index].split(":");
      request.headers[name.trim().toLowerCase()] = value.join(":").trim();
    } else if (arg === "-d") {
      request.body = args[++index];
    } else if (arg === "-X") {
      explicitMethod = args[++index];
    } else if (arg === "-N") {
      // Disables curl's output buffering; it changes nothing on the wire.
    } else if (arg.startsWith("-")) {
      throw new Error(`Unsupported curl option ${arg}`);
    } else {
      request.url = arg;
    }
  }
  request.method = explicitMethod ?? (request.body === undefined ? "GET" : "POST");
  return request;
}

function shellWords(command: string, variables: Record<string, string>): string[] {
  const words: string[] = [];
  let word: string | undefined;
  let quote: "'" | '"' | undefined;
  const text = command.replace(/\\\n/g, " ");

  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quote === undefined && /\s/.test(char)) {
      if (word !== undefined) words.push(word);
      word = undefined;
    } else if (quote === undefined && (char === "'" || char === '"')) {
      quote = char;
      word ??= "";
    } else if (char === quote) {
      quote = undefined;
    } else if (char === "$" && quote !== "'") {
      const name = /^\w+/.exec(text.slice(index + 1))?.[0] ?? "";
      if (!(name in variables)) {
        throw new Error(`Undefined shell variable $${name}`);
      }
      word = (word ?? "") + variables[name];
      index += name.length;
    } else {
      word = (word ?? "") + char;
    }
  }
  if (quote !== undefined) {
    throw new Error("Unterminated quote in curl command");
  }
  if (word !== undefined) words.push(word);
  return words;
}
