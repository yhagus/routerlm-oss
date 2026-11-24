import { execSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";

const REPO = execSync("git rev-parse --show-toplevel").toString().trim();
const WORK = process.argv[2];
if (!WORK) {
  console.error("usage: bun apply.ts <work-dir>");
  process.exit(1);
}
process.chdir(REPO);

const DELETED = new Set(["tautology", "stale", "excuse", "decision"]);

interface Part { byteStart: number; byteEnd: number; ownLine: boolean }
interface Block { id: string; file: string; functional: boolean; parts: Part[] }
interface Verdict { id: string; category: string }

const blocks: Block[] = JSON.parse(readFileSync(`${WORK}/inventory.json`, "utf8"));
const verdicts = new Map<string, Verdict>();
for (const file of readdirSync(`${WORK}/results`).filter((f) => f.endsWith(".json"))) {
  for (const verdict of JSON.parse(readFileSync(`${WORK}/results/${file}`, "utf8")).blocks as Verdict[]) {
    verdicts.set(verdict.id, verdict);
  }
}

const unclassified = blocks.filter((b) => !b.functional && !verdicts.has(b.id));
if (unclassified.length > 0) {
  console.warn(`${unclassified.length} blocks have no verdict and stay: ${unclassified.slice(0, 10).map((b) => b.id).join(", ")}`);
}

const byFile = new Map<string, Part[]>();
for (const block of blocks) {
  const category = verdicts.get(block.id)?.category;
  if (block.functional || !category || !DELETED.has(category)) continue;
  byFile.set(block.file, [...(byFile.get(block.file) ?? []), ...block.parts]);
}

let removedLines = 0;
for (const [file, parts] of byFile) {
  const original = readFileSync(file);
  let text = original.toString("utf8");
  const toIndex = (byte: number) => original.subarray(0, byte).toString("utf8").length;
  for (const part of [...parts].sort((a, b) => b.byteStart - a.byteStart)) {
    let start = toIndex(part.byteStart);
    let end = toIndex(part.byteEnd);
    if (part.ownLine) {
      start = text.lastIndexOf("\n", start - 1) + 1;
      const newline = text.indexOf("\n", end);
      end = newline === -1 ? text.length : newline + 1;
    } else {
      while (start > 0 && (text[start - 1] === " " || text[start - 1] === "\t")) start -= 1;
    }
    text = text.slice(0, start) + text.slice(end);
  }
  text = text.replace(/\n{3,}/g, "\n\n").replace(/^\n+/, "");
  removedLines += original.toString("utf8").split("\n").length - text.split("\n").length;
  writeFileSync(file, text);
}
console.log(`Deleted comments in ${byFile.size} files, ${removedLines} lines removed before formatting.`);
