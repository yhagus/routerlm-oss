import { defineConfig } from 'vitest/config';

// E2E tests truncate tables, so they get their own database rather than the
// app's DATABASE_URL (which bun loads from .env). test/global-setup.ts creates
// and migrates it. Set TEST_DATABASE_URL to use another server or database.
process.env.TEST_DATABASE_URL ??= 'postgres://routerlm:routerlm@localhost:5432/routerlm_test';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    globalSetup: ['./test/global-setup.ts'],
    // Test files share the database and truncate it, so they run one at a time.
    fileParallelism: false,
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL,
    },
  },
});
