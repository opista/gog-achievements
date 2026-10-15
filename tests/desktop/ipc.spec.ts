import { _electron, expect, test } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { OperationState } from '../../src/shared/api';

test('sandboxed Electron uses Nest and the generated bridge for the workspace flow', async () => {
  const userData = await mkdtemp(join(tmpdir(), 'gog-achievements-desktop-'));
  const packageDirectory = process.env.GOG_DESKTOP_PACKAGE_DIRECTORY;
  const executablePath = packageDirectory
    ? join(
        resolve(packageDirectory),
        ...(process.platform === 'darwin'
          ? ['Contents', 'MacOS', 'GOG Achievements']
          : ['GOG Achievements.exe']),
      )
    : undefined;
  const application = await _electron.launch({
    executablePath,
    args: [
      ...(packageDirectory ? [] : [resolve('out/main/index.js')]),
      `--user-data-dir=${userData}`,
    ],
    env: { ...process.env, GOG_ACHIEVEMENTS_DEMO: '1' },
  });
  try {
    const page = await application.firstWindow();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await expect(page).toHaveTitle('GOG Achievements');
    await expect(page.getByRole('heading', { name: 'Get unlocking' })).toBeVisible();
    await expect(page.getByText('DEMO DATA', { exact: true })).toBeVisible();
    expect(
      await page.evaluate(() => ({ require: typeof require, process: typeof process })),
    ).toEqual({
      require: 'undefined',
      process: 'undefined',
    });
    const initial = await page.evaluate(() => window.ipc.workspace.initialize());
    expect(initial).toMatchObject({ ok: true, data: { auth: { authenticated: false } } });
    const invalid = await page.evaluate(() => window.ipc.workspace.listAchievements('../invalid'));
    expect(invalid).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });

    // A browser-context observer proves events arrive without exposing ipcRenderer.
    await page.evaluate(() => {
      const observed: OperationState[] = [];
      Object.assign(window, { observed });
      const unsubscribe = window.gogPlatform!.onOperation((state) => observed.push(state));
      Object.assign(window, { unsubscribe });
    });
    await page.getByRole('button', { name: 'Sign in with GOG', exact: true }).click();
    await expect(
      page.locator('.game-heading').getByRole('heading', { name: 'Cyberpunk 2077', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Apply changes for Cyberpunk 2077', exact: true }),
    ).toBeEnabled();
    await page
      .getByRole('button', { name: 'Apply changes for Cyberpunk 2077', exact: true })
      .click();
    const confirmation = page.getByRole('dialog', { name: 'Apply 3 achievements?', exact: true });
    await expect(confirmation).toBeVisible();
    await confirmation.getByRole('button', { name: 'Apply 3 achievements', exact: true }).click();
    await expect(
      page.getByText('All requested unlocks and dates were confirmed.', { exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'History', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Unlock history', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'History', exact: true })).toBeEnabled();
    await page.screenshot({ path: test.info().outputPath('workspace.png') });
    const observed = await page.evaluate(() => {
      const fixture = window as unknown as { observed: OperationState[]; unsubscribe(): void };
      fixture.unsubscribe();
      return fixture.observed.map((state) => state.kind);
    });
    expect(observed).toContain('login');
    expect(observed).toContain('apply');
    expect(observed.at(-1)).toBe('idle');
    expect(errors).toEqual([]);
  } finally {
    await application.close();
    await rm(userData, { recursive: true, force: true });
  }
});
