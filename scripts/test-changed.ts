import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const TESTS_FOR_MODULES_NAMED_DIFFERENTLY: Record<string, string[]> = {
  routing: ['tests/models', 'tests/inference'],
  'spend-limits': ['tests/inference/spend-limit.test.ts', 'tests/api-keys'],
  upstream: ['tests/upstream-models', 'tests/providers', 'tests/provider-accounts'],
  users: ['tests/auth'],
};

const SHARED_FOUNDATION_PREFIXES = [
  'src/libs/',
  'src/db/',
  'src/redis/',
  'src/backend-roles/',
  'drizzle/',
  'tests/support/',
];
const SHARED_FOUNDATION_FILES = new Set([
  'tests/global-setup.ts',
  'vitest.config.ts',
  'package.json',
  'bun.lock',
  'docker-compose.test.yml',
  'scripts/test-docker.ts',
]);

function git(args: string[]): string[] {
  const result = spawnSync('git', args, { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  }
  return result.stdout.split('\n').filter((line) => line.length > 0);
}

function changedFiles(): string[] {
  const [base] = git(['merge-base', 'HEAD', 'main']);
  const files = new Set([
    ...git(['diff', '--name-only', base]),
    ...git(['ls-files', '--others', '--exclude-standard']),
  ]);
  return [...files].filter((file) => existsSync(file));
}

function isWide(file: string): boolean {
  if (
    SHARED_FOUNDATION_FILES.has(file) ||
    SHARED_FOUNDATION_PREFIXES.some((prefix) => file.startsWith(prefix))
  ) {
    return true;
  }
  return /^src\/[^/]+\.ts$/.test(file);
}

function testTargets(file: string): string[] {
  const [root, folder] = file.split('/');
  if (root === 'tests' && folder !== undefined && folder !== 'k6') {
    return [file.endsWith('.test.ts') ? file : `tests/${folder}`];
  }
  if (root === 'src' && folder !== undefined) {
    return TESTS_FOR_MODULES_NAMED_DIFFERENTLY[folder] ?? [`tests/${folder}`];
  }
  return [];
}

const files = changedFiles();
const wide = files.filter(isWide);
const targets = [
  ...new Set(
    files
      .filter((file) => !isWide(file))
      .flatMap(testTargets)
      .filter((target) => existsSync(target)),
  ),
].toSorted();

if (wide.length > 0) {
  console.log('test:changed: these changes reach every feature; the full suite runs in CI:');
  for (const file of wide) {
    console.log(`  ${file}`);
  }
}
if (targets.length === 0) {
  console.log('test:changed: no feature tests map to the changes; name them with test:docker.');
  process.exit(0);
}
console.log(`test:changed: running ${targets.join(' ')}`);
const result = spawnSync('bun', ['scripts/test-docker.ts', ...targets, ...process.argv.slice(2)], {
  stdio: 'inherit',
});
process.exit(result.status ?? 1);
