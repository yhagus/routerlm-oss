import { spawnSync, execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const REPO = execSync("git rev-parse --show-toplevel").toString().trim();
const WORK = process.argv[2];
const PART_SIZE = Number(process.argv[3] ?? 450);
if (!WORK) {
  console.error("usage: bun inventory.ts <work-dir> [blocks-per-partition]");
  process.exit(1);
}
process.chdir(REPO);
mkdirSync(`${WORK}/parts`, { recursive: true });
mkdirSync(`${WORK}/results`, { recursive: true });

const LINTED = ["src", "tests", "scripts", "web/app", "web/server", "web/nuxt.config.ts", "web/content.config.ts"];
const VENDORED = /^web\/app\/components\/(ui|ai-elements)\//;
const FUNCTIONAL = /^\s*(\/[/*]\s*(@ts-|eslint-|oxlint-|@vue-ignore|[#@]__PURE__)|<!--\s*eslint-)|the backend's `/;

interface Comment { file: string; byteStart: number; byteEnd: number; text: string; line: number; endLine: number; ownLine: boolean }

const lint = spawnSync(
  "node_modules/.bin/oxlint",
  ["-c", ".oxlintrc.comments.json", "-A", "all", "-D", "routerlm/no-comments", "-f", "json", ...LINTED],
  { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 },
);
const diagnostics: { code: string; filename: string; labels: { span: { offset: number; length: number } }[] }[] =
  JSON.parse(lint.stdout).diagnostics.filter((d: { code: string }) => d.code === "routerlm(no-comments)");

const buffers = new Map<string, Buffer>();
const bufferOf = (file: string) => {
  if (!buffers.has(file)) buffers.set(file, readFileSync(file));
  return buffers.get(file)!;
};

const spans: { file: string; byteStart: number; byteEnd: number }[] = diagnostics.map((d) => ({
  file: d.filename,
  byteStart: d.labels[0].span.offset,
  byteEnd: d.labels[0].span.offset + d.labels[0].span.length,
}));

const unparsed = execSync("git ls-files 'web/*.css' 'web/*.vue'").toString().trim().split("\n");
for (const file of unparsed.filter((f) => !VENDORED.test(f))) {
  const text = readFileSync(file, "utf8");
  const pattern = file.endsWith(".css") ? /\/\*[\s\S]*?\*\//g : /<!--[\s\S]*?-->/g;
  for (const match of text.matchAll(pattern)) {
    const byteStart = Buffer.byteLength(text.slice(0, match.index));
    spans.push({ file, byteStart, byteEnd: byteStart + Buffer.byteLength(match[0]) });
  }
}

const comments: Comment[] = spans
  .sort((a, b) => a.file.localeCompare(b.file) || a.byteStart - b.byteStart)
  .map(({ file, byteStart, byteEnd }) => {
    const buffer = bufferOf(file);
    const before = buffer.subarray(0, byteStart).toString("utf8");
    const text = buffer.subarray(byteStart, byteEnd).toString("utf8");
    const after = buffer.subarray(byteEnd).toString("utf8").split("\n")[0];
    const line = before.split("\n").length;
    const ownLine = before.slice(before.lastIndexOf("\n") + 1).trim() === "" && after.trim() === "";
    return { file, byteStart, byteEnd, text, line, endLine: line + text.split("\n").length - 1, ownLine };
  });

interface Block { id: string; file: string; line: number; endLine: number; ownLine: boolean; text: string; functional: boolean; parts: Comment[] }
const blocks: Block[] = [];
for (const comment of comments) {
  const previous = blocks.at(-1);
  const continues =
    previous && previous.file === comment.file && previous.ownLine && comment.ownLine &&
    comment.line === previous.endLine + 1 && comment.text.startsWith("//") && previous.text.startsWith("//");
  if (continues) {
    previous.parts.push(comment);
    previous.endLine = comment.endLine;
    previous.text += `\n${comment.text}`;
  } else {
    blocks.push({ id: "", file: comment.file, line: comment.line, endLine: comment.endLine, ownLine: comment.ownLine, text: comment.text, functional: false, parts: [comment] });
  }
}
blocks.forEach((block, index) => {
  block.id = `c${String(index + 1).padStart(4, "0")}`;
  block.functional = FUNCTIONAL.test(block.text);
});
writeFileSync(`${WORK}/inventory.json`, JSON.stringify(blocks, null, 1));

const area = (file: string) => file.split("/").slice(0, file.startsWith("web/app/") ? 3 : 2).join("/");
const byArea = new Map<string, Block[]>();
for (const block of blocks.filter((b) => !b.functional)) {
  byArea.set(area(block.file), [...(byArea.get(area(block.file)) ?? []), block]);
}
const partitions: Block[][] = [[]];
for (const [, areaBlocks] of [...byArea].sort((a, b) => b[1].length - a[1].length)) {
  for (const block of areaBlocks) {
    const current = partitions.at(-1)!;
    const startsNewFile = current.at(-1)?.file !== block.file;
    if (current.length >= PART_SIZE && startsNewFile) partitions.push([]);
    partitions.at(-1)!.push(block);
  }
}
const sourceLines = new Map<string, string[]>();
partitions.filter((p) => p.length > 0).forEach((partition, index) => {
  const entries = partition.map((block) => {
    if (!sourceLines.has(block.file)) sourceLines.set(block.file, readFileSync(block.file, "utf8").split("\n"));
    return {
      id: block.id,
      at: `${block.file}:${block.line}${block.endLine > block.line ? `-${block.endLine}` : ""}`,
      trailing: block.ownLine ? undefined : true,
      comment: block.text,
      codeAfter: sourceLines.get(block.file)!.slice(block.endLine, block.endLine + 4).join("\n"),
    };
  });
  writeFileSync(`${WORK}/parts/p${index + 1}.json`, JSON.stringify(entries, null, 1));
  const areas = [...new Set(partition.map((b) => area(b.file)))].join(", ");
  console.log(`p${index + 1}: ${partition.length} blocks (${areas})`);
});

const ownLines = blocks.filter((b) => b.ownLine && !b.functional).reduce((sum, b) => sum + b.endLine - b.line + 1, 0);
console.log(
  `${comments.length} comments in ${blocks.length} blocks; ${blocks.filter((b) => b.functional).length} functional blocks kept; ${ownLines} comment-only lines to shed.`,
);
