import { defineConfig } from 'vitest/config';

// solana-bankrun's native binding leaks memory across test files; isolating
// each test file into its own forked process keeps totals bounded for CI.
export default defineConfig({
  test: {
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: false,
        isolate: true,
      },
    },
  },
});
