import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

// providers.update writes every column the caller sends and merges `data`
// one level deep over the stored data: each top-level key in `data`
// replaces the stored key. A caller that sends a copy of Connection data it
// read earlier therefore writes back old values for fields that other
// requests changed in the meantime. A caller that changes only data fields
// (or isActive) uses providers.patch, which merges over the newest row.
//
// The guard flags two shapes:
// 1. An update whose arguments carry a copy of Connection data: a spread of
//    `x.data` (in any number of parentheses), a variable built from such a
//    spread or from an alias of `x.data`, or a full-copy helper.
// 2. An update whose argument object has only `data` and `isActive` keys.

const SOURCE_ROOT = join(import.meta.dir, "..", "src");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(ts|js)$/.test(entry.name) ? [path] : [];
  });
}

const OPEN = "([{";
const CLOSE = ")]}";

// Text from `start` to the bracket that closes depth 0, or to the first
// `stop` character at depth 0.
function balanced(source: string, start: number, stop: string): string {
  let depth = 0;
  let end = start;
  while (end < source.length) {
    const char = source[end];
    if (OPEN.includes(char)) depth += 1;
    else if (CLOSE.includes(char)) {
      if (depth === 0) break;
      depth -= 1;
    } else if (depth === 0 && stop.includes(char)) break;
    end += 1;
  }
  return source.slice(start, end);
}

// Splits on commas at depth 0.
function topLevelParts(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let from = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (OPEN.includes(char)) depth += 1;
    else if (CLOSE.includes(char)) depth -= 1;
    else if (char === "," && depth === 0) {
      parts.push(text.slice(from, index));
      from = index + 1;
    }
  }
  parts.push(text.slice(from));
  return parts.map((part) => part.trim()).filter(Boolean);
}

// The argument text of each providers.update(...) call.
function updateCalls(source: string): string[] {
  return [...source.matchAll(/providers\.update\(/g)].map((match) => balanced(source, match.index! + match[0].length, ""));
}

// `const|let|var name[: type] = initializer` declarations of one file.
function declarations(source: string): Array<{ name: string; init: string }> {
  return [...source.matchAll(/\b(?:const|let|var)\s+([\w$]+)\s*(?::[^=;]+)?=(?!=)/g)]
    .map((match) => ({ name: match[1], init: balanced(source, match.index! + match[0].length, ";\n") }));
}

// `x.data` of a stored Connection. Request payloads (`body.data`,
// `input.data`, `payload.data`) are what the caller sends, not a copy.
const DATA_EXPRESSION = String.raw`(?:\(\s*)*(?!(?:body|input|payload|request)\.)[\w$.]+\??\.data\b`;
const DIRECT_COPY = new RegExp(String.raw`\.\.\.\s*${DATA_EXPRESSION}|\b(?:dataPatch|patchData)\(`);

// Variables that alias Connection data (`x.data`, `(a?.data ?? b.data)`) and
// variables that hold a copy of it (a spread of `x.data` or of an alias).
function taintedNames(source: string): { aliases: Set<string>; copies: Set<string> } {
  const aliases = new Set<string>();
  const copies = new Set<string>();
  const decls = declarations(source);
  let changed = true;
  while (changed) {
    changed = false;
    for (const { name, init } of decls) {
      if (!aliases.has(name) && new RegExp(String.raw`^\s*${DATA_EXPRESSION}`).test(init)) {
        aliases.add(name);
        changed = true;
      }
      const spreadsAlias = [...aliases].some((alias) => new RegExp(String.raw`\.\.\.\s*(?:\(\s*)*${alias}\b(?!\s*\[)`).test(init));
      const holdsCopy = [...copies].some((copy) => new RegExp(String.raw`^\s*\{?\s*(?:\.\.\.\s*)?${copy}\b`).test(init));
      if (!copies.has(name) && (DIRECT_COPY.test(init) || spreadsAlias || holdsCopy)) {
        copies.add(name);
        changed = true;
      }
    }
  }
  return { aliases, copies };
}

function carriesCopy(call: string, tainted: { aliases: Set<string>; copies: Set<string> }): boolean {
  if (DIRECT_COPY.test(call)) return true;
  if ([...tainted.aliases].some((alias) => new RegExp(String.raw`(?:\.\.\.\s*(?:\(\s*)*|\bdata\s*:\s*)${alias}\b(?!\s*\[)`).test(call))) return true;
  // A copy passed as a value (`{ data }`, `data: copy`, `...copy`); a key
  // with the same name (`data: {...}`) is not a use.
  return [...tainted.copies].some((copy) => new RegExp(String.raw`(?<![\w$.])${copy}\b(?!\s*:)`).test(call));
}

// True when every object literal at the top of the second argument (also in
// a ternary) has only `data` and `isActive` keys.
function onlyDataFields(call: string): boolean {
  const patchArgument = topLevelParts(call)[1];
  if (!patchArgument) return false;
  const literals: string[] = [];
  for (let index = 0; index < patchArgument.length; index += 1) {
    if (patchArgument[index] !== "{") continue;
    const body = balanced(patchArgument, index + 1, "");
    literals.push(body);
    index += body.length + 1;
  }
  if (!literals.length) return false;
  return literals.every((literal) => topLevelParts(literal).every((part) => {
    if (part.startsWith("...")) return false;
    const key = part.split(":")[0].trim();
    return key === "data" || key === "isActive";
  }));
}

function fullUpdateWriters(files: Array<{ path: string; source: string }>): string[] {
  return files.flatMap(({ path, source }) => {
    const tainted = taintedNames(source);
    return updateCalls(source)
      .filter((call) => carriesCopy(call, tainted) || onlyDataFields(call))
      .map((call) => `${path}: providers.update(${call.replace(/\s+/g, " ").slice(0, 120)})`);
  });
}

const flaggedFiles = (files: Array<{ path: string; source: string }>) => fullUpdateWriters(files).map((line) => line.split(":")[0]);

describe("Connection full-update guard", () => {
  test("no backend source passes a copy of Connection data, or only data fields, into providers.update", () => {
    const files = sourceFiles(SOURCE_ROOT).map((path) => ({ path: relative(SOURCE_ROOT, path), source: readFileSync(path, "utf8") }));

    expect(fullUpdateWriters(files)).toEqual([]);
  });

  test("the guard flags the stale-copy shapes that earlier migrations removed", () => {
    expect(flaggedFiles([
      { path: "embeddings.ts", source: "runtime.repos.providers.update(connection.id, { data: { ...connection.data, accessToken } });" },
      { path: "scheduler.ts", source: "runtime.repos.providers.update(connection.id, {\n  data: dataPatch(connection, { accessToken: token.accessToken }),\n});" },
      { path: "patch.ts", source: "runtime.repos.providers.patch(connection.id, { data: { accessToken } });" },
    ])).toEqual(["embeddings.ts", "scheduler.ts"]);
  });

  test("the guard flags each pre-fix form of the credentials, invite chain and Codex credit writers", () => {
    expect(flaggedFiles([
      // markAccountUnavailable: a double-parenthesis spread into a variable.
      {
        path: "markAccountUnavailable.ts",
        source: `const current = runtime.repos.providers.get(connection.id);
  const data: Record<string, unknown> = {
    ...((current?.data ?? connection.data) as Record<string, unknown>),
    [lockKey]: until,
    testStatus: "unavailable",
  };
  runtime.repos.providers.update(connection.id, disableAccount ? { data, isActive: false } : { data });`,
      },
      // clearAccountError: an alias of the data, then a spread of the alias.
      {
        path: "clearAccountError.ts",
        source: `const data = (current?.data ?? connection.data) as Record<string, unknown>;
  let next = { ...data };
  for (const key of keysToClear) next[key] = null;
  runtime.repos.providers.update(connection.id, { data: next });`,
      },
      // clearConnectionLocks: a parenthesised spread into a variable.
      {
        path: "clearConnectionLocks.ts",
        source: `const data = { ...(current.data as Record<string, unknown>) };
  data.backoffLevel = 0;
  runtime.repos.providers.update(connectionId, { data });`,
      },
      // Invite chain: data-only updates.
      {
        path: "inviteChainState.ts",
        source: `runtime.repos.providers.update(connectionId, {
    data: { [CHAIN_KEY]: { ...existing, ...patch, updatedAt: new Date().toISOString() } },
  });`,
      },
      { path: "inviteChainProxy.ts", source: "runtime.repos.providers.update(connectionId, { data: { proxyPoolId: poolId } });" },
      // Codex reset credits: a persist callback with a data-only update.
      { path: "codexCredits.ts", source: "const refreshed = await refreshCodexConnection(current, (data) => runtime.repos.providers.update(current.id, { data }));" },
      // A duplicate merge: an isActive-only update.
      { path: "mergeDuplicates.ts", source: "runtime.repos.providers.update(row.id, { isActive: false });" },
    ])).toEqual(["markAccountUnavailable.ts", "clearAccountError.ts", "clearConnectionLocks.ts", "inviteChainState.ts", "inviteChainProxy.ts", "codexCredits.ts", "mergeDuplicates.ts"]);
  });

  test("the guard flags an indirect copy even when the update also sends other columns", () => {
    expect(flaggedFiles([
      {
        path: "doubleParen.ts",
        source: "const data = { ...((current?.data ?? connection.data) as Record<string, unknown>), lastError: null };\nruntime.repos.providers.update(id, { ...input, name, data });",
      },
      {
        path: "aliasSpread.ts",
        source: "const stored = current.data;\nconst next = { ...stored, lastError: null };\nruntime.repos.providers.update(id, { ...input, data: next });",
      },
    ])).toEqual(["doubleParen.ts", "aliasSpread.ts"]);
  });

  test("the guard accepts full updates that replace a Connection on purpose", () => {
    expect(flaggedFiles([
      { path: "oauthRelogin.ts", source: "runtime.repos.providers.update(existing.id, { ...payload, isActive: true });" },
      { path: "dashboardEdit.ts", source: "runtime.repos.providers.update(id, { ...body, data: { ...((body.data || {}) as Record<string, unknown>), ...v1FlatDataPatch(body) } });" },
      { path: "import.ts", source: "const data = providerData({}, { accessToken });\nproviders.update(existing.id, { data, name, email, lastError: null });" },
    ])).toEqual([]);
  });
});
