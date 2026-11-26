import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const runFile = promisify(execFile);
const STARTUP_TIMEOUT_MS = 30_000;
const KEY_HELP = 'generate one with `openssl rand -base64 32`';
const API_ENTRY_POINT = fileURLToPath(new URL('../../src/main.ts', import.meta.url));
const TSCONFIG = fileURLToPath(new URL('../../tsconfig.json', import.meta.url));
const ANY_FREE_PORT = '0';

async function logOfStartupWith(encryptionKey: string | undefined): Promise<string> {
  const { ENCRYPTION_KEY: _testKey, ...env } = process.env;
  const workingDirectory = await mkdtemp(join(tmpdir(), 'startup-'));
  try {
    await runFile('bun', [`--tsconfig-override=${TSCONFIG}`, API_ENTRY_POINT], {
      cwd: workingDirectory,
      env: {
        ...env,
        PORT: ANY_FREE_PORT,
        ...(encryptionKey === undefined ? {} : { ENCRYPTION_KEY: encryptionKey }),
      },
      timeout: STARTUP_TIMEOUT_MS,
    });
  } catch (error) {
    if (error instanceof Error && 'stdout' in error && 'stderr' in error) {
      return `${String(error.stdout)}${String(error.stderr)}`;
    }
    throw error;
  } finally {
    await rm(workingDirectory, { recursive: true, force: true });
  }
  throw new Error('The API process exited cleanly instead of refusing to start');
}

describe('Startup configuration (e2e)', () => {
  it(
    'refuses to start without ENCRYPTION_KEY and says how to generate one',
    async () => {
      expect(await logOfStartupWith(undefined)).toContain(KEY_HELP);
    },
    STARTUP_TIMEOUT_MS,
  );

  it(
    "refuses to start with an ENCRYPTION_KEY that isn't 32 bytes",
    async () => {
      expect(await logOfStartupWith('c2hvcnQ=')).toContain(KEY_HELP);
    },
    STARTUP_TIMEOUT_MS,
  );
});
