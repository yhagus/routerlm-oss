import { execFileSync } from "node:child_process";

interface Commit {
  hash: string;
  type: string;
  scope: string | undefined;
  subject: string;
  breaking: boolean;
}

const SECTIONS: [heading: string, types: string[]][] = [
  ["Features", ["feat"]],
  ["Bug fixes", ["fix"]],
  ["Performance", ["perf"]],
  ["Refactors", ["refactor"]],
  ["Docs", ["docs"]],
  ["Tests", ["test"]],
  ["Build and CI", ["build", "ci"]],
  ["Chores", ["chore", "style", "revert"]],
];

const HEADER = /^(\w+)(?:\(([^)]+)\))?(!)?: (.+)$/;
const FIELD = "\u001f";
const RECORD = "\u001e";

function git(...args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function repositoryUrl(): string {
  const remote = git("remote", "get-url", "origin");
  const path = /github\.com[:/](.+?)(?:\.git)?$/.exec(remote)?.[1];
  if (!path) throw new Error(`origin is not a GitHub remote: ${remote}`);
  return `https://github.com/${path}`;
}

function commitsBetween(from: string, to: string): Commit[] {
  const log = git(
    "log",
    "--no-merges",
    `--format=%H${FIELD}%s${FIELD}%b${RECORD}`,
    `${from}..${to}`,
  );
  return log
    .split(RECORD)
    .map((record) => record.trim())
    .filter((record) => record.length > 0)
    .flatMap((record): Commit[] => {
      const [hash = "", header = "", body = ""] = record.split(FIELD);
      const match = HEADER.exec(header);
      if (!match)
        return [{ hash, type: "other", scope: undefined, subject: header, breaking: false }];
      const [, type = "", scope, bang, subject = ""] = match;
      const breaking = bang === "!" || body.includes("BREAKING CHANGE");
      return [{ hash, type, scope, subject, breaking }];
    })
    .filter((commit) => !(commit.type === "chore" && commit.scope === "release"));
}

function lineOf(commit: Commit, repository: string): string {
  const header = `${commit.type}${commit.scope ? `(${commit.scope})` : ""}: ${commit.subject}`;
  const link = `[${commit.hash.slice(0, 7)}](${repository}/commit/${commit.hash})`;
  return `  * ${link} ${header}${commit.breaking ? " (**breaking**)" : ""}`;
}

function sectionOf(heading: string, commits: Commit[], repository: string): string[] {
  if (commits.length === 0) return [];
  const byScope = new Map<string, Commit[]>();
  for (const commit of commits) {
    const scope = commit.scope ?? "general";
    byScope.set(scope, [...(byScope.get(scope) ?? []), commit]);
  }
  const scopes = [...byScope.keys()].toSorted((a, b) => a.localeCompare(b));
  return [
    `#### ${heading}`,
    ...scopes.flatMap((scope) => [
      `* \`${scope}\``,
      ...(byScope.get(scope) ?? []).map((commit) => lineOf(commit, repository)),
    ]),
    "",
  ];
}

const [previousTag, newTag, ref = "HEAD"] = process.argv.slice(2);
if (!previousTag || !newTag) {
  console.error("usage: bun scripts/release-notes.ts <previous-tag> <new-tag> [<ref>]");
  process.exit(1);
}

const repository = repositoryUrl();
const commits = commitsBetween(previousTag, ref);
const known = new Set(SECTIONS.flatMap(([, types]) => types));
const lines = [
  ...SECTIONS.flatMap(([heading, types]) =>
    sectionOf(
      heading,
      commits.filter((commit) => types.includes(commit.type)),
      repository,
    ),
  ),
  ...sectionOf(
    "Other",
    commits.filter((commit) => !known.has(commit.type)),
    repository,
  ),
  `**Full Changelog**: ${repository}/compare/${previousTag}...${newTag}`,
];
console.log(lines.join("\n"));
