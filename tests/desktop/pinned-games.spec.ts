import { _electron, expect, test } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

test('game pins survive a native app restart in the same local profile', async () => {
  const userData = await mkdtemp(join(tmpdir(), 'gog-pinned-games-'));
  const directory = process.env.GOG_DESKTOP_PACKAGE_DIRECTORY;
  const executablePath = directory
    ? join(
        resolve(directory),
        ...(process.platform === 'darwin'
          ? ['Contents', 'MacOS', 'GOG Achievements']
          : ['GOG Achievements.exe']),
      )
    : undefined;
  let application: Awaited<ReturnType<typeof _electron.launch>> | undefined;
  try {
    for (const restarted of [false, true]) {
      application = await _electron.launch({
        executablePath,
        args: [...(directory ? [] : [resolve('.')]), `--user-data-dir=${userData}`],
        env: { ...process.env, GOG_ACHIEVEMENTS_DEMO: '1' },
      });
      const page = await application.firstWindow();
      await page.getByRole('button', { name: 'Sign in with GOG', exact: true }).click();
      await expect(page.locator('.game-heading h2')).toHaveText('Cyberpunk 2077');
      await expect(
        page.getByRole('button', { name: 'Refresh library', exact: true }),
      ).toBeEnabled();
      const pin = page.getByRole('button', { name: 'Pin Hades', exact: true });
      const unpin = page.getByRole('button', { name: 'Unpin Hades', exact: true });
      if (!restarted) await pin.click();
      await expect(unpin).toHaveAttribute('aria-pressed', 'true');
      await expect(page.locator('.game-title').first()).toHaveText('Hades');
      await expect(page.locator('.game-heading h2')).toHaveText('Cyberpunk 2077');
      if (restarted) {
        await unpin.click();
        await expect(pin).toHaveAttribute('aria-pressed', 'false');
        await expect(page.locator('.game-title').first()).toHaveText('Cyberpunk 2077');
      }
      await application.close();
      application = undefined;
    }
  } finally {
    await application?.close();
    await rm(userData, { recursive: true, force: true });
  }
});
