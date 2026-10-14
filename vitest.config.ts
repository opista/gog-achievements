import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    restoreMocks: true,
    // Keep jsdom workers within hosted runners' CPU and memory limits.
    maxWorkers: 4,
    setupFiles: ['tests/setup.ts'],
    testTimeout: 10000,
  },
});
