import { _electron, expect, test } from '@playwright/test';
import { build } from 'vite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { createRequire, isBuiltin } from 'node:module';
import type { UpdateFixture } from './fixtures/cli-update-app';

test('a verified CLI activates in the same Electron session after an open review closes', async () => {
  test.setTimeout(60000);
  const directory = await mkdtemp(join(tmpdir(), 'gog-cli-live-electron-'));
  let application: Awaited<ReturnType<typeof _electron.launch>> | undefined;
  try {
    await build({
      configFile: false,
      publicDir: false,
      logLevel: 'error',
      build: {
        lib: {
          entry: resolve('tests/desktop/fixtures/cli-update-app.ts'),
          formats: ['cjs'],
          fileName: () => 'main.cjs',
        },
        outDir: directory,
        emptyOutDir: false,
        rollupOptions: {
          external: (id) => !id.startsWith('.') && !isAbsolute(id),
          output: {
            paths: (id) =>
              id === 'electron' || isBuiltin(id)
                ? id
                : createRequire(resolve('package.json')).resolve(id),
          },
        },
      },
    });
    application = await _electron.launch({
      args: [join(directory, 'main.cjs'), `--user-data-dir=${join(directory, 'profile')}`],
      env: {
        ...process.env,
        GOG_UPDATE_FIXTURE_PROJECT: resolve('.'),
      },
    });
    const pid = application.process().pid;
    const diagnostics: string[] = [];
    application.process().stderr?.on('data', (chunk) => diagnostics.push(String(chunk)));
    const page = await application.firstWindow().catch((error: Error) => {
      throw new Error(`${error.message}\n${diagnostics.join('').slice(-4000)}`);
    });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await expect(page.getByRole('button', { name: 'History', exact: true })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Export CSV', exact: true })).toBeDisabled();
    let navigations = 0;
    page.on('framenavigated', () => {
      navigations++;
    });
    await application.evaluate(({ app }) =>
      (app as typeof app & { updateFixture: UpdateFixture }).updateFixture.start(),
    );
    await page.getByLabel('Account menu', { exact: true }).click();
    await expect(page.locator('.account-cli-progress')).toBeVisible();
    await page
      .locator('.account-popover')
      .screenshot({ path: test.info().outputPath('downloading.png') });
    await page.getByLabel('Account menu', { exact: true }).press('Escape');
    await page
      .getByRole('button', { name: 'Queue unlock for Achievement 101', exact: true })
      .click();
    await page
      .getByRole('button', { name: 'Review changes for Cyberpunk 2077', exact: true })
      .click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await application.evaluate(async ({ app }) =>
      (app as typeof app & { updateFixture: UpdateFixture }).updateFixture.finish(),
    );
    expect(
      await application.evaluate(({ app }) =>
        (app as typeof app & { updateFixture: UpdateFixture }).updateFixture.snapshot(),
      ),
    ).toMatchObject({ status: 'ready', currentVersion: '0.5.1', pendingVersion: '0.6.0' });
    await page
      .getByRole('dialog')
      .screenshot({ path: test.info().outputPath('waiting-for-review.png') });
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Export CSV', exact: true })).toBeEnabled();
    await page.getByLabel('Account menu', { exact: true }).click();
    await expect(page.getByText('CLI 0.6.0', { exact: true })).toBeVisible();
    await page
      .locator('.account-popover')
      .screenshot({ path: test.info().outputPath('activated-without-restart.png') });
    expect(application.process().pid).toBe(pid);
    expect(navigations).toBe(0);
    expect(
      await application.evaluate(({ app }) =>
        (app as typeof app & { updateFixture: UpdateFixture }).updateFixture.writes(),
      ),
    ).toBe(0);
    expect(errors).toEqual([]);
  } finally {
    await application?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
