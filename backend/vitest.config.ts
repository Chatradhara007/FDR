import { defineConfig } from 'vitest/config';

// Tests share one real database (fdr_test), so they run serially in a single fork.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    pool: 'forks',
    fileParallelism: false,
    globalSetup: ['tests/globalSetup.ts'],
    setupFiles: ['tests/testEnv.ts'],
    testTimeout: 15_000,
    hookTimeout: 30_000,
  },
});
