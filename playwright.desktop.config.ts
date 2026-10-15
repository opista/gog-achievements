import { defineConfig } from '@playwright/test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export default defineConfig({
  testDir: './tests/desktop',
  workers: 1,
  timeout: 30000,
  expect: { timeout: 5000 },
  reporter: 'list',
  outputDir: join(process.env.RUNNER_TEMP ?? tmpdir(), 'gog-achievements-desktop'),
});
