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
    // Run bridge imports through Vitest so its real IPC code uses the Electron mock.
    server: { deps: { inline: ['@electron-ipc-bridge/core'] } },
    testTimeout: 10000,
  },
});
