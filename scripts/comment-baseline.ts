import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const BASELINE_FILE = 'comment-baseline.json';
const RULE_CODE = 'routerlm(no-comments)';
const LINTED_PATHS = [
  'src',
  'tests',
  'scripts',
  'web/app',
  'web/server',
  'web/nuxt.config.ts',
  'web/content.config.ts',
];

interface Diagnostic {
  code: string;
  filename: string;
}

function countCommentsPerFile(): Map<string, number> {
  const result = spawnSync(
    'oxlint',
    [
      '-c',
      '.oxlintrc.comments.json',
      '-A',
      'all',
      '-D',
      'routerlm/no-comments',
      '-f',
      'json',
      ...LINTED_PATHS,
    ],
    { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 },
  );
  if (result.error) {
    throw new Error('could not run oxlint', { cause: result.error });
  }
  const output: { diagnostics: Diagnostic[] } = JSON.parse(result.stdout);
  const counts = new Map<string, number>();
  for (const diagnostic of output.diagnostics) {
    if (diagnostic.code === RULE_CODE) {
      counts.set(diagnostic.filename, (counts.get(diagnostic.filename) ?? 0) + 1);
    }
  }
  return counts;
}

function readBaseline(): Record<string, number> {
  return existsSync(BASELINE_FILE) ? JSON.parse(readFileSync(BASELINE_FILE, 'utf8')) : {};
}

const allowGrowth = process.argv.includes('--allow-growth');
const previous = readBaseline();
const counts = countCommentsPerFile();

const grown = [...counts].filter(([file, count]) => count > (previous[file] ?? 0));
if (grown.length > 0 && !allowGrowth && existsSync(BASELINE_FILE)) {
  for (const [file, count] of grown) {
    console.error(`${file}: ${count} comments, baseline allows ${previous[file] ?? 0}`);
  }
  console.error(
    `\ncomments:baseline: the ratchet only moves down. Delete the new comments, or pass --allow-growth when a reviewer agreed to it (ADR 0042).`,
  );
  process.exit(1);
}

const baseline = Object.fromEntries([...counts].sort(([a], [b]) => a.localeCompare(b)));
writeFileSync(BASELINE_FILE, `${JSON.stringify(baseline, null, 2)}\n`);
const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
console.log(`${BASELINE_FILE}: ${total} comments left in ${counts.size} files.`);
