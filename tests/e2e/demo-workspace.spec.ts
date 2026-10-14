import { expect, test, type Page } from '@playwright/test';
import type { OperationRecord, Queue } from '../../src/shared/api';

const DEMO_STORAGE = 'gog-achievements-demo:v1';
const errors = new WeakMap<Page, string[]>();
const externalRequests = new WeakMap<Page, string[]>();

async function savedDemo(page: Page): Promise<{ queues: Queue[]; records: OperationRecord[] }> {
  const value = await page.evaluate((key) => localStorage.getItem(key), DEMO_STORAGE);
  return value
    ? (JSON.parse(value) as { queues: Queue[]; records: OperationRecord[] })
    : { queues: [], records: [] };
}

async function signIn(page: Page) {
  await expect(page.getByRole('heading', { name: 'Connect GOG' })).toBeVisible();
  const login = page.getByRole('button', { name: 'Sign in to GOG', exact: true });
  await expect(login).toBeEnabled();
  await login.click();
  await expect(page.getByRole('heading', { name: 'Cyberpunk 2077', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'History', exact: true })).toBeEnabled();
}

async function review(page: Page) {
  await page.getByRole('button', { name: 'Preview changes', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Review changes', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue to apply' })).toBeEnabled();
}

async function confirmApply(page: Page) {
  await review(page);
  await page.getByRole('button', { name: 'Continue to apply' }).click();
  const confirmation = page.getByRole('dialog', { name: 'Apply 3 achievements?' });
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole('button', { name: 'Apply 3 achievements', exact: true }).click();
}

test.beforeEach(async ({ page, baseURL }) => {
  const pageErrors: string[] = [];
  const blocked: string[] = [];
  errors.set(page, pageErrors);
  externalRequests.set(page, blocked);
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') pageErrors.push(message.text());
  });
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.origin === new URL(baseURL!).origin) return route.continue();
    blocked.push(url.origin);
    return route.abort();
  });
  await page.goto('/?demo=1&theme=light');
  await expect(page).toHaveTitle('GOG Achievements');
  await expect(page.getByRole('heading', { name: 'GOG Achievements', exact: true })).toBeVisible();
  await expect(page.getByText('DEMO DATA', { exact: true })).toBeVisible();
});

test.afterEach(async ({ page }) => {
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
  expect(errors.get(page) ?? [], 'No uncaught or console errors').toEqual([]);
  expect(externalRequests.get(page) ?? [], 'Demo must make no external network requests').toEqual(
    [],
  );
});

test('compact library keeps game art, plain achievement details and existing unlock protection', async ({
  page,
}) => {
  await signIn(page);
  const world = page.locator('.achievement-row').filter({ hasText: 'The World' });
  const unlocked = page.locator('.achievement-row').filter({ hasText: 'Full Body Conversion' });
  await expect(world.getByText('The World', { exact: true })).toBeVisible();
  await expect(world.getByText(/Sample achievement description/)).toBeVisible();
  await expect(world.getByRole('button')).toHaveCount(0);
  await expect(unlocked.getByRole('checkbox')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Details for / })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Apply changes', exact: true })).toBeDisabled();
  await expect(page.getByText('A sample hidden achievement', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Reveal', exact: true }).click();
  await expect(page.getByText('A sample hidden achievement', { exact: true })).toBeVisible();

  const covers = page.locator('.library-pane .game-row .art-game');
  await expect(covers).toHaveCount(8);
  await expect(covers.first()).toBeVisible();
  expect(
    await covers.first().evaluate((element) => getComputedStyle(element).backgroundImage),
  ).toContain('demo-covers.png');
  const coverBox = await covers.first().boundingBox();
  const rowBox = await page.locator('.library-pane .game-row').first().boundingBox();
  expect(coverBox?.height).toBeLessThanOrEqual(44);
  expect(rowBox?.height).toBeLessThanOrEqual(64);

  const search = page.getByLabel('Search your library', { exact: true });
  const clear = page
    .locator('.search-field')
    .getByRole('button', { name: 'Clear library search', exact: true });
  await search.fill('Cyberpunk');
  await expect(clear).toBeVisible();
  await expect(page.locator('.library-pane .game-row')).toHaveCount(1);
  await clear.click();
  await expect(search).toHaveValue('');
  await expect(page.locator('.library-pane .game-row')).toHaveCount(8);
  await search.fill('no matching game');
  await expect(page.getByText('No games match your search.')).toBeVisible();
  await clear.click();
  await expect(search).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Cyberpunk 2077', exact: true })).toBeVisible();

  const summary = page.locator('.account-menu summary');
  await expect(summary).toHaveText('GOG account');
  await expect(summary).not.toContainText('123456789');
  await summary.click();
  await expect(page.locator('.account-popover')).toContainText('123456789');
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Connect GOG' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Preview changes', exact: true })).toBeDisabled();
});

test('queue selection and date edits save the actual draft without an apply', async ({ page }) => {
  await signIn(page);
  await page.getByRole('checkbox', { name: 'Select Legend of The Afterlife', exact: true }).check();
  await page.getByRole('button', { name: 'Add selected', exact: true }).click();
  const remove = page.getByRole('button', { name: 'Remove Legend of The Afterlife from queue' });
  await expect(remove).toBeEnabled();
  await remove.click();
  await expect(remove).toHaveCount(0);
  await page.getByRole('button', { name: 'Edit date for The World' }).click();
  const dialog = page.getByRole('dialog', { name: 'Queue dates', exact: true });
  await expect(dialog).toBeVisible();
  await dialog
    .getByRole('combobox', { name: 'Display time zone', exact: true })
    .selectOption('UTC');
  const date = dialog.getByLabel('Unlock date for The World', { exact: true });
  await date.fill('2099-01-01');
  await expect(dialog.getByRole('button', { name: 'Save dates', exact: true })).toBeDisabled();
  await date.fill('2020-02-02');
  await dialog.getByLabel('Unlock time for The World', { exact: true }).fill('13:14:15');
  await expect(dialog.getByRole('button', { name: 'Save dates', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Save dates', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText('Draft saved', { exact: true })).toBeVisible();
  const saved = await savedDemo(page);
  expect(saved.queues[0]?.items.find((item) => item.achievement_id === '1')?.unlocked_at).toBe(
    '2020-02-02T13:14:15Z',
  );
  expect(saved.records).toHaveLength(0);
  await page.reload();
  await signIn(page);
  await page.getByRole('button', { name: 'Edit date for The World' }).click();
  await page
    .getByRole('dialog', { name: 'Queue dates' })
    .getByRole('combobox', { name: 'Display time zone', exact: true })
    .selectOption('UTC');
  await expect(page.getByLabel('Unlock date for The World', { exact: true })).toHaveValue(
    '2020-02-02',
  );
});

test('preview and dismissed confirmation leave achievements and operation history unchanged', async ({
  page,
}) => {
  await signIn(page);
  await review(page);
  expect((await savedDemo(page)).records).toHaveLength(0);
  await expect(page.getByText('No changes have been sent.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Continue to apply' }).click();
  const dialog = page.getByRole('dialog', { name: 'Apply 3 achievements?' });
  await expect(dialog.getByRole('button', { name: 'Back to preview' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Review changes', exact: true })).toBeVisible();
  expect((await savedDemo(page)).records).toHaveLength(0);
  await page.getByRole('button', { name: 'Back to queue', exact: true }).click();
  await expect(
    page.getByRole('checkbox', { name: 'Select The World', exact: true }),
  ).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Edit date for The World' })).toBeEnabled();
});

test('explicit apply confirms once, retains a report and restores read-only history after reload', async ({
  page,
}) => {
  await signIn(page);
  await confirmApply(page);
  await expect(page.getByRole('heading', { name: 'Results confirmed', exact: true })).toBeVisible();
  await expect(page.getByText('Confirmed', { exact: true })).toHaveCount(3);
  const history = page.getByRole('button', { name: 'History', exact: true });
  await expect(history).toBeEnabled();
  const saved = await savedDemo(page);
  expect(saved.records).toHaveLength(1);
  expect(saved.queues.find((queue) => queue.game.id === '1')?.items).toHaveLength(0);
  await history.click();
  await expect(page.getByRole('heading', { name: 'Operation history' })).toBeVisible();
  await expect(
    page.getByText('Saved reports are read-only. They cannot undo an unlock.'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'View report', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Results confirmed', exact: true })).toBeVisible();
  expect((await savedDemo(page)).records).toHaveLength(1);
  await page.reload();
  await signIn(page);
  await page.getByRole('button', { name: 'History', exact: true }).click();
  await expect(page.getByText('Completed', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Back to achievements', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit date for The World' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Preview changes', exact: true })).toBeDisabled();
  await expect(
    page.locator('.achievement-row').filter({ hasText: 'The World' }).getByRole('checkbox'),
  ).toHaveCount(0);
  const reopened = await savedDemo(page);
  expect(reopened.records).toHaveLength(1);
  expect(reopened.queues.find((queue) => queue.game.id === '1')?.items).toHaveLength(0);
});

for (const scenario of ['partial', 'unknown'] as const) {
  test(
    scenario + ' outcomes retain one report and never replay during recovery reads',
    async ({ page }) => {
      await signIn(page);
      await page.getByRole('combobox', { name: 'Demo scenario' }).selectOption(scenario);
      await expect(
        page.getByRole('button', { name: 'Preview changes', exact: true }),
      ).toBeEnabled();
      await confirmApply(page);
      await expect(
        page.getByRole('heading', {
          name: scenario === 'partial' ? 'Results need attention' : 'Outcome unknown',
          exact: true,
        }),
      ).toBeVisible();
      if (scenario === 'partial') {
        await expect(
          page.getByText('Unlocked with a different date', { exact: true }),
        ).toBeVisible();
        await expect(page.getByText('Outcome uncertain', { exact: true })).toBeVisible();
        await expect(page.getByText('Not attempted', { exact: true })).toBeVisible();
      }
      const current = page.getByRole('button', { name: 'Check current state', exact: true });
      await expect(current).toBeEnabled();
      await current.click();
      const history = page.getByRole('button', { name: 'History', exact: true });
      await expect(history).toBeEnabled();
      await history.click();
      await expect(page.getByRole('button', { name: 'View report', exact: true })).toBeVisible();
      const saved = await savedDemo(page);
      expect(saved.records).toHaveLength(1);
      expect(
        saved.queues
          .find((queue) => queue.game.id === '1')
          ?.items.map((item) => item.achievement_id),
      ).toEqual(scenario === 'partial' ? ['2', '3'] : ['1', '2', '3']);
      await page.getByRole('button', { name: 'Back to achievements', exact: true }).click();
      await expect(
        page.getByRole('button', { name: 'Preview changes', exact: true }),
      ).toBeEnabled();
      await expect(page.getByRole('button', { name: 'Apply changes', exact: true })).toBeDisabled();
      expect((await savedDemo(page)).records).toHaveLength(1);
      if (scenario === 'partial')
        await expect(page.getByRole('button', { name: 'Edit date for The World' })).toHaveCount(0);
      await expect(
        page.getByRole('button', { name: 'Edit date for Frequent Flyer' }),
      ).toBeEnabled();
    },
  );
}

test('desktop, minimum desktop and mobile previews keep document and date dialog within viewport', async ({
  page,
}, testInfo) => {
  await signIn(page);
  for (const viewport of [
    { width: 1586, height: 992 },
    { width: 1120, height: 720 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(page.getByRole('button', { name: 'Preview changes', exact: true })).toBeEnabled();
    const dimensions = await page.evaluate(() => ({
      content: document.documentElement.scrollWidth,
      viewport: document.documentElement.clientWidth,
    }));
    expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport + 1);
    await page.screenshot({ path: testInfo.outputPath('workspace-' + viewport.width + '.png') });
  }
  await page.getByRole('button', { name: 'Edit date for The World' }).click();
  const dialog = page.getByRole('dialog', { name: 'Queue dates' });
  await expect(dialog).toBeVisible();
  const box = await dialog.boundingBox();
  expect(box?.width).toBeLessThanOrEqual(390);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).toHaveCount(0);
});

test('a browser without the explicit demo flag cannot pretend to have a desktop bridge', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByText(/The desktop bridge is unavailable/)).toBeVisible();
  await expect(page.getByText('DEMO DATA', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Sign in to GOG', exact: true })).toHaveCount(0);
});
