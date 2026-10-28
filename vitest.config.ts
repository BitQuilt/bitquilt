import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts'],
    // A tracker test replays its whole ledger at every post, and the full run shares one machine: the limit is set for that, not for a single test alone.
    // GitHub's shared Intel Mac runner takes five times what this Mac does on the same file (28 October 2026), so the limit allows for it.
    testTimeout: 90_000,
  },
});
