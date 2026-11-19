import { configDefaults, defineConfig } from 'vitest/config';

// Feature tests (tests/<feature>/*.test.ts) drive the app from outside: HTTP,
// CLI or boot. They truncate tables, so they get their own database rather than the
// app's DATABASE_URL (which bun loads from .env). tests/global-setup.ts creates
// and migrates it. Set TEST_DATABASE_URL to use another server or database.
process.env.TEST_DATABASE_URL ??= 'postgres://routerlm:routerlm@localhost:5432/routerlm_test';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['tests/**/*.test.ts'],
    // Agent worktrees under .claude/ hold their own copies of the tests.
    exclude: [...configDefaults.exclude, '.claude/**'],
    globalSetup: ['./tests/global-setup.ts'],
    // Test files share the database and truncate it, so they run one at a time.
    fileParallelism: false,
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL,
      // Queues connect at boot but fail fast without Redis, so only the tests
      // that run the worker need a reachable Redis here.
      REDIS_URL: process.env.REDIS_URL ?? 'redis://localhost:6379',
      // A fixed test-only key; it encrypts nothing real.
      ENCRYPTION_KEY: 'dGVzdC1vbmx5LWVuY3J5cHRpb24ta2V5LTMyLWJ5dGU=',
    },
  },
});
