import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'backend/test/**/*.test.ts',
      'evaluation/test/**/*.test.ts',
      'frontend/src/**/*.test.{ts,tsx}',
      'scripts/azure/**/*.test.ts',
      'scripts/demo/**/*.test.ts',
      'scripts/mutation/**/*.test.ts',
    ],
    environment: 'node',
    // A timeout is there to catch a hang, not to measure speed. The heaviest tests run a whole
    // simulation or a PDF worker and take 7-14 s when the machine is busy, so 15 s failed them
    // while they were passing.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    restoreMocks: true,
  },
});
