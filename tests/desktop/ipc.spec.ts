import { _electron, expect, test } from '@playwright/test';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { OperationState } from '../../src/shared/api';

const packageDirectory = process.env.GOG_DESKTOP_PACKAGE_DIRECTORY;
const executablePath = packageDirectory
  ? join(
      resolve(packageDirectory),
      ...(process.platform === 'darwin'
        ? ['Contents', 'MacOS', 'GOG Achievements']
        : ['GOG Achievements.exe']),
    )
  : undefined;
const applicationPath = packageDirectory
  ? join(
      resolve(packageDirectory),
      ...(process.platform === 'darwin'
        ? ['Contents', 'Resources', 'app.asar']
        : ['resources', 'app.asar']),
    )
  : resolve('.');

for (const existing of [false, true]) {
  test(`the display name uses the original profile folder (${existing ? 'existing' : 'new'} install)`, async () => {
    const appData = await realpath(await mkdtemp(join(tmpdir(), 'gog-achievements-profile-')));
    const profile = join(appData, 'gog-achievements');
    const saved = join(profile, 'saved-profile.txt');
    if (existing) {
      await mkdir(profile);
      await writeFile(saved, 'saved queues and history');
    }
    const bootstrap = join(appData, 'app-data.cjs');
    await writeFile(
      bootstrap,
      `require('electron').app.setPath('appData', ${JSON.stringify(appData)});`,
    );
    let application: Awaited<ReturnType<typeof _electron.launch>> | undefined;
    try {
      // The stock executable supports an appData preload, including with packaged app code.
      application = await _electron.launch({
        args: ['-r', bootstrap, applicationPath],
        env: { ...process.env, GOG_ACHIEVEMENTS_DEMO: '1' },
      });
      const page = await application.firstWindow();
      await expect(
        page.getByRole('button', { name: 'Sign in with GOG', exact: true }),
      ).toBeEnabled();
      expect(
        await application.evaluate(({ app }) => ({
          name: app.getName(),
          userData: app.getPath('userData'),
          sessionData: app.getPath('sessionData'),
        })),
      ).toEqual({ name: 'GOG Achievements', userData: profile, sessionData: profile });
      if (existing) expect(await readFile(saved, 'utf8')).toBe('saved queues and history');
    } finally {
      await application?.close();
      await rm(appData, { recursive: true, force: true });
    }
  });
}

test('sandboxed Electron uses Nest and the generated bridge for the workspace flow', async () => {
  const userData = await mkdtemp(join(tmpdir(), 'gog-achievements-desktop-'));
  const application = await _electron.launch({
    executablePath,
    args: [...(packageDirectory ? [] : [resolve('.')]), `--user-data-dir=${userData}`],
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
    expect(await application.evaluate(({ app }) => app.getName())).toBe('GOG Achievements');
    const profile = await realpath(userData);
    const paths = await application.evaluate(({ app }) => ({
      userData: app.getPath('userData'),
      sessionData: app.getPath('sessionData'),
    }));
    expect(await realpath(paths.userData)).toBe(profile);
    expect(await realpath(paths.sessionData)).toBe(profile);
    if (process.platform === 'darwin') {
      expect(
        await application.evaluate(({ Menu }) =>
          Menu.getApplicationMenu()
            ?.items[0]?.submenu?.items.filter((item) =>
              ['about', 'hide', 'quit'].includes(item.role ?? ''),
            )
            .map((item) => item.label),
        ),
      ).toEqual(['About GOG Achievements', 'Hide GOG Achievements', 'Quit GOG Achievements']);
    }
    const nativeWindow = await application.browserWindow(page);
    expect(await nativeWindow.evaluate((window) => window.autoHideMenuBar)).toBe(
      process.platform === 'win32',
    );
    if (packageDirectory) {
      await nativeWindow.evaluate((window) => window.webContents.openDevTools());
      const viewRoles = await application.evaluate(({ Menu }) =>
        Menu.getApplicationMenu()
          ?.items.find((item) => item.role?.toLowerCase() === 'viewmenu')
          ?.submenu?.items.map((item) => item.role?.toLowerCase()),
      );
      expect(viewRoles).toContain('resetzoom');
      expect(viewRoles).not.toContain('reload');
      expect(viewRoles).not.toContain('forcereload');
      expect(viewRoles).not.toContain('toggledevtools');
    }
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
      page.getByRole('button', { name: 'Review changes for Cyberpunk 2077', exact: true }),
    ).toBeEnabled();
    await page.getByRole('button', { name: 'Clear queue for Cyberpunk 2077', exact: true }).click();
    await expect(page.getByText('Queue is empty.', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Unlock all', exact: true }).click();
    await expect(page.locator('.queue-row')).toHaveCount(4);
    await page.getByRole('button', { name: 'Lock all', exact: true }).click();
    await expect(page.locator('.queue-row')).toHaveCount(2);
    for (const name of ['Full Body Conversion', 'Daemon In The Shell']) {
      await expect(
        page.getByRole('button', { name: `Remove ${name} from queue`, exact: true }),
      ).toBeEnabled();
    }
    await page.getByRole('button', { name: 'Queue unlock for The World', exact: true }).click();
    await page
      .getByRole('button', { name: 'Review changes for Cyberpunk 2077', exact: true })
      .click();
    const confirmation = page.getByRole('dialog', {
      name: 'Apply changes to 3 achievements?',
      exact: true,
    });
    await expect(confirmation).toBeVisible();
    const modal = await confirmation.elementHandle();
    await confirmation
      .getByRole('button', {
        name: 'Apply changes',
        exact: true,
      })
      .click();
    await expect(page.getByRole('dialog', { name: 'Changes applied', exact: true })).toBeVisible();
    expect(
      await modal!.evaluate((element) => element === document.querySelector('[role="dialog"]')),
    ).toBe(true);
    await expect(page.getByRole('dialog').getByText('1 unlocked', { exact: true })).toBeVisible();
    await expect(page.getByRole('dialog').getByText('2 locked', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'View history', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Achievement history', exact: true }),
    ).toBeVisible();
    await expect(
      page
        .getByRole('list', { name: 'Confirmed changes', exact: true })
        .getByText('Locked', { exact: true }),
    ).toHaveCount(2);
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
    if (packageDirectory)
      expect(await nativeWindow.evaluate((window) => window.webContents.isDevToolsOpened())).toBe(
        false,
      );
    expect(errors).toEqual([]);
  } finally {
    await application.close();
    await rm(userData, { recursive: true, force: true });
  }
});
