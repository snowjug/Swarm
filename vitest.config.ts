import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['backend/test/**/*.test.ts', 'frontend/src/**/*.test.{ts,tsx}'],
    environment: 'node',
    testTimeout: 15000,
    restoreMocks: true,
  },
});
