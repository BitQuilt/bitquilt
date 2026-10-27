import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts'],
    // A tracker test replays its whole ledger at every post, and the full run shares one machine: the limit is set for that, not for a single test alone.
    testTimeout: 20_000,
  },
});
