import { existsSync, readFileSync } from "node:fs";
import { relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

const DIRECTIVE =
  /^\s*(?:@ts-(?:expect-error|ignore|nocheck)\b|(?:eslint|oxlint)-(?:disable|enable)|@vue-ignore\b|[#@]__PURE__)/;

const baselines = new Map();

function loadBaseline(path) {
  if (!baselines.has(path)) {
    const absolute = `${REPO_ROOT}${path}`;
    baselines.set(path, existsSync(absolute) ? JSON.parse(readFileSync(absolute, "utf8")) : {});
  }
  return baselines.get(path);
}

export function countedComments(sourceCode) {
  return sourceCode.getAllComments().filter((comment) => !DIRECTIVE.test(comment.value));
}

const noComments = {
  meta: {
    type: "suggestion",
    docs: { description: "Bans code comments, ratcheted down per file by a baseline (ADR 0042)." },
    schema: [
      {
        type: "object",
        properties: { baseline: { type: "string" } },
        additionalProperties: false,
      },
    ],
  },
  create(context) {
    const baselinePath = context.options[0]?.baseline;
    const baseline = baselinePath ? loadBaseline(baselinePath) : {};
    const file = relative(REPO_ROOT, context.filename).split(sep).join("/");
    return {
      Program(program) {
        const comments = countedComments(context.sourceCode);
        const allowed = baseline[file] ?? 0;
        if (comments.length > allowed) {
          const message =
            allowed === 0
              ? "Comments are banned: name things so the code explains itself, and record decisions in docs/adr/ (ADR 0042)."
              : `This file has ${comments.length} comments and ${baselinePath} allows ${allowed}: delete comments, never add them (ADR 0042).`;
          for (const comment of comments) {
            context.report({ loc: comment.loc, message });
          }
        } else if (comments.length < allowed) {
          context.report({
            node: program,
            message: `This file has ${comments.length} comments but ${baselinePath} still allows ${allowed}: run \`bun run comments:baseline\` to ratchet it down (ADR 0042).`,
          });
        }
      },
    };
  },
};

export default {
  meta: { name: "routerlm" },
  rules: { "no-comments": noComments },
};
