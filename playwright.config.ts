import { defineConfig, devices } from '@playwright/test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const port = 5174;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 2,
  timeout: 30000,
  expect: { timeout: 5000 },
  use: {
    baseURL: 'http://127.0.0.1:' + port,
    timezoneId: 'America/New_York',
    viewport: { width: 1440, height: 900 },
    actionTimeout: 5000,
    navigationTimeout: 10000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1586, height: 992 } },
    },
  ],
  webServer: {
    command: 'npm run dev:web -- --host 127.0.0.1 --port ' + port + ' --strictPort',
    url: 'http://127.0.0.1:' + port,
    reuseExistingServer: false,
    timeout: 30000,
  },
  reporter: 'list',
  outputDir: join(tmpdir(), 'gog-achievements-e2e'),
});
