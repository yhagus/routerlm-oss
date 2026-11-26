import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const WEB_DIRECTORY = 'web';

function run(command: string, args: string[], cwd = '.'): void {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' });
  if (result.error) {
    throw new Error(`could not run ${command} ${args.join(' ')}`, { cause: result.error });
  }
  if (result.status !== 0) {
    console.error(
      `\npre-commit: \`${command} ${args.join(' ')}\` failed in ${cwd}; commit aborted.`,
    );
    process.exit(result.status ?? 1);
  }
}

function stagedFiles(): string[] {
  const result = spawnSync('git', ['diff', '--cached', '--name-only'], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`git diff --cached failed: ${result.stderr}`);
  }
  return result.stdout.split('\n').filter((file) => file.length > 0);
}

run('bun', ['run', 'check']);

const touchesWeb = stagedFiles().some((file) => file.startsWith(`${WEB_DIRECTORY}/`));
if (touchesWeb) {
  if (!existsSync(`${WEB_DIRECTORY}/node_modules`)) {
    run('bun', ['install', '--frozen-lockfile'], WEB_DIRECTORY);
  }
  run('bun', ['run', 'check'], WEB_DIRECTORY);
}
