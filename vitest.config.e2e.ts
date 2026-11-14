import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    // The pg pool connects lazily, so e2e tests that never query still boot
    // AppModule without a running database. A DATABASE_URL in the shell wins.
    env: {
      DATABASE_URL:
        process.env.DATABASE_URL ?? 'postgres://routerlm:routerlm@localhost:5432/routerlm',
    },
  },
});
