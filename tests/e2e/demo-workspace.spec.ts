import { expect, test, type Page } from '@playwright/test';
import type { OperationRecord, Queue } from '../../src/shared/api';

const DEMO_STORAGE = 'gog-achievements-demo:v1';
const CYBERPUNK = 'Cyberpunk 2077';
const WITCHER = 'The Witcher 3: Wild Hunt';
const errors = new WeakMap<Page, string[]>();
const externalRequests = new WeakMap<Page, string[]>();

async function savedDemo(page: Page): Promise<{ queues: Queue[]; records: OperationRecord[] }> {
  const value = await page.evaluate((key) => localStorage.getItem(key), DEMO_STORAGE);
  return value
    ? (JSON.parse(value) as { queues: Queue[]; records: OperationRecord[] })
    : { queues: [], records: [] };
}

function gameQueue(page: Page, title = CYBERPUNK) {
  return page.getByRole('region', { name: `Queue for ${title}`, exact: true });
}

function applyButton(page: Page, title = CYBERPUNK) {
  return page.getByRole('button', { name: `Apply changes for ${title}`, exact: true });
}

async function signIn(page: Page) {
  await expect(page.getByRole('heading', { name: 'Your GOG achievements' })).toBeVisible();
  const login = page.getByRole('button', { name: 'Sign in with GOG', exact: true });
  await expect(login).toBeEnabled();
  await login.click();
  await expect(
    page.locator('.game-heading').getByRole('heading', { name: CYBERPUNK, exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'History', exact: true })).toBeEnabled();
}

async function useUtc(page: Page) {
  await page.getByRole('combobox', { name: /^Time zone/ }).selectOption('UTC');
}

async function confirmation(page: Page, title = CYBERPUNK, count = 3) {
  await expect(applyButton(page, title)).toBeEnabled();
  await applyButton(page, title).click();
  const dialog = page.getByRole('dialog', {
    name: `Apply ${count} achievement${count === 1 ? '' : 's'}?`,
    exact: true,
  });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function confirmApply(page: Page, title = CYBERPUNK, count = 3) {
  const dialog = await confirmation(page, title, count);
  await dialog
    .getByRole('button', {
      name: `Apply ${count} achievement${count === 1 ? '' : 's'}`,
      exact: true,
    })
    .click();
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
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  await expect(unlocked.getByRole('button')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Add Legend of The Afterlife to queue', exact: true }),
  ).toBeEnabled();
  await expect(page.getByRole('button', { name: /^Details for / })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'Queued', exact: true })).toHaveCount(0);
  await expect(applyButton(page)).toBeEnabled();
  await expect(page.getByText('A sample hidden achievement', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Reveal', exact: true }).click();
  await expect(page.getByText('A sample hidden achievement', { exact: true })).toBeVisible();

  const covers = page.locator('.library-pane .game-row .art-game');
  await expect(covers).toHaveCount(8);
  await expect(covers.first()).toBeVisible();
  expect(
    await covers.first().evaluate((element) => getComputedStyle(element).backgroundImage),
  ).toContain('demo-covers.png');
  expect((await covers.first().boundingBox())?.height).toBeLessThanOrEqual(44);
  expect(
    (await page.locator('.library-pane .game-row').first().boundingBox())?.height,
  ).toBeLessThanOrEqual(64);

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
  await expect(page.getByRole('button', { name: CYBERPUNK, exact: true })).toBeVisible();

  const summary = page.locator('.account-menu summary');
  await expect(summary).toHaveAttribute('aria-label', 'Account menu');
  await expect(summary).toHaveText('');
  await expect(summary).not.toContainText('123456789');
  await summary.click();
  await expect(page.locator('.account-popover')).toContainText('123456789');
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your GOG achievements' })).toBeVisible();
  await expect(page.locator('.queue-game-group')).toHaveCount(0);
});

test('single-item date edits stay local until Save date and persist exact seconds', async ({
  page,
}) => {
  await signIn(page);
  await page
    .getByRole('button', { name: 'Add Legend of The Afterlife to queue', exact: true })
    .click();
  const remove = page.getByRole('button', { name: 'Remove Legend of The Afterlife from queue' });
  await expect(remove).toBeEnabled();
  await remove.click();
  await expect(remove).toHaveCount(0);
  await useUtc(page);
  const edit = page.getByRole('button', { name: 'Edit date for The World', exact: true });
  const originalTitle = await edit.getAttribute('title');
  await edit.click();
  const dialog = page.getByRole('dialog', { name: 'Edit unlock date', exact: true });
  const date = dialog.getByLabel('Unlock date for The World', { exact: true });
  await expect(date).toHaveAttribute('type', 'datetime-local');
  await expect(date).toHaveAttribute('step', '1');
  await date.fill('2099-01-01T13:14:15');
  await expect(dialog.getByText(/Unlock dates must not be in the future/)).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Save date', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(edit).toHaveAttribute('title', originalTitle!);
  await edit.click();
  await date.fill('2020-02-02T13:14:15');
  await dialog.getByRole('heading', { name: 'Edit unlock date', exact: true }).click();
  expect(
    (await savedDemo(page)).queues.find((queue) => queue.game.id === '1')?.items[0]?.unlocked_at,
  ).toBe('2026-10-10T17:30:00Z');
  await dialog.getByRole('button', { name: 'Save date', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect
    .poll(
      async () =>
        (await savedDemo(page)).queues
          .find((queue) => queue.game.id === '1')
          ?.items.find((item) => item.achievement_id === '1')?.unlocked_at,
    )
    .toBe('2020-02-02T13:14:15Z');
  expect((await savedDemo(page)).records).toHaveLength(0);
  await expect(edit).toHaveAttribute('title', '02 Feb 2020 13:14:15 · UTC (UTC+00:00)');
  await page.reload();
  await signIn(page);
  await useUtc(page);
  await edit.click();
  await expect(date).toHaveValue('2020-02-02T13:14:15');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect((await savedDemo(page)).records).toHaveLength(0);
});

test('the single apply confirmation can be dismissed without changing achievements or history', async ({
  page,
}) => {
  await signIn(page);
  await useUtc(page);
  const dialog = await confirmation(page);
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await expect(dialog.getByRole('heading', { name: CYBERPUNK, exact: true })).toBeVisible();
  await expect(dialog.getByText('The World', { exact: true })).toBeVisible();
  expect((await savedDemo(page)).records).toHaveLength(0);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Review changes', exact: true })).toHaveCount(0);
  await expect(gameQueue(page).locator('.queue-row')).toHaveCount(3);
  await expect(
    page.getByRole('button', { name: 'Edit date for The World', exact: true }),
  ).toBeEnabled();
  await expect(applyButton(page)).toBeEnabled();
  expect((await savedDemo(page)).records).toHaveLength(0);
});

test('explicit apply clears confirmed requests and keeps flat achievement history after reload', async ({
  page,
}) => {
  await signIn(page);
  await confirmApply(page);
  await expect(page.getByRole('heading', { name: 'Results confirmed', exact: true })).toBeVisible();
  await expect(page.getByText('Confirmed', { exact: true })).toHaveCount(3);
  await expect(page.getByText('Queue is empty.', { exact: true })).toBeVisible();
  const history = page.getByRole('button', { name: 'History', exact: true });
  await expect(history).toBeEnabled();
  const saved = await savedDemo(page);
  expect(saved.records).toHaveLength(1);
  expect(saved.queues.find((queue) => queue.game.id === '1')?.items).toHaveLength(0);
  await history.click();
  await expect(
    page.getByRole('heading', { name: 'Achievement history', exact: true }),
  ).toBeVisible();
  const unlocks = page.getByRole('list', { name: 'Unlocked achievements', exact: true });
  await expect(unlocks.getByRole('listitem')).toHaveCount(3);
  expect(await unlocks.locator('strong').allTextContents()).toEqual([
    'The Wandering Fool',
    'Frequent Flyer',
    'The World',
  ]);
  await expect(
    unlocks.getByRole('listitem').filter({ hasText: 'The World' }).locator('time'),
  ).toHaveAttribute('datetime', '2026-10-10T17:30:00Z');
  await expect(page.getByRole('button', { name: 'View report', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Back to achievements', exact: true })).toHaveCount(
    0,
  );
  await page.reload();
  await signIn(page);
  await history.click();
  await expect(unlocks.getByRole('listitem')).toHaveCount(3);
  await page.getByRole('button', { name: CYBERPUNK, exact: true }).click();
  await expect(
    page.locator('.game-heading').getByRole('heading', { name: CYBERPUNK, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Edit date for The World', exact: true }),
  ).toHaveCount(0);
  await expect(applyButton(page)).toHaveCount(0);
  await expect(
    page.locator('.achievement-row').filter({ hasText: 'The World' }).getByRole('button'),
  ).toHaveCount(0);
  const reopened = await savedDemo(page);
  expect(reopened.records).toHaveLength(1);
  expect(reopened.queues.find((queue) => queue.game.id === '1')?.items).toHaveLength(0);
});

for (const scenario of ['partial', 'unknown'] as const) {
  test(
    scenario + ' outcomes retain unresolved requests and never replay from flat history',
    async ({ page }) => {
      await signIn(page);
      await page.getByRole('combobox', { name: 'Demo scenario' }).selectOption(scenario);
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
      await expect(
        page.getByRole('button', { name: 'Check current state', exact: true }),
      ).toBeEnabled();
      await page.getByRole('button', { name: 'Check current state', exact: true }).click();
      const history = page.getByRole('button', { name: 'History', exact: true });
      await expect(history).toBeEnabled();
      await history.click();
      const attention = page.getByRole('list', { name: 'Results needing attention', exact: true });
      await expect(attention.getByRole('listitem')).toHaveCount(scenario === 'partial' ? 2 : 1);
      const unlocks = page.getByRole('list', { name: 'Unlocked achievements', exact: true });
      if (scenario === 'partial') {
        await expect(unlocks.getByRole('listitem')).toHaveCount(1);
        await expect(unlocks.getByText('The World', { exact: true })).toBeVisible();
        await expect(attention.getByText('Outcome uncertain', { exact: true })).toBeVisible();
      } else {
        await expect(unlocks).toHaveCount(0);
        await expect(attention.getByText('Outcome unknown', { exact: true })).toBeVisible();
      }
      await expect(
        page.getByRole('button', { name: 'Edit date for Frequent Flyer', exact: true }),
      ).toBeEnabled();
      const saved = await savedDemo(page);
      expect(saved.records).toHaveLength(1);
      expect(
        saved.queues
          .find((queue) => queue.game.id === '1')
          ?.items.map((item) => item.achievement_id),
      ).toEqual(scenario === 'partial' ? ['2', '3'] : ['1', '2', '3']);
      await page.getByRole('button', { name: CYBERPUNK, exact: true }).click();
      await expect(
        page.locator('.game-heading').getByRole('heading', { name: CYBERPUNK, exact: true }),
      ).toBeVisible();
      await expect(applyButton(page)).toBeEnabled();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      expect((await savedDemo(page)).records).toHaveLength(1);
      if (scenario === 'partial')
        await expect(
          page.getByRole('button', { name: 'Edit date for The World', exact: true }),
        ).toHaveCount(0);
    },
  );
}

test('per-game apply retains the other global queue across selection, history and reload', async ({
  page,
}) => {
  await signIn(page);
  await page.getByRole('button', { name: WITCHER, exact: true }).click();
  const passed = page.getByRole('button', { name: 'Add Passed the Trial to queue', exact: true });
  await expect(passed).toBeEnabled();
  await passed.click();
  await expect(applyButton(page, WITCHER)).toBeEnabled();
  await expect(gameQueue(page).locator('.queue-row')).toHaveCount(3);
  await expect(gameQueue(page, WITCHER).locator('.queue-row')).toHaveCount(1);
  await page.getByRole('button', { name: CYBERPUNK, exact: true }).click();
  await expect(
    page.locator('.game-heading').getByRole('heading', { name: CYBERPUNK, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Edit date for Passed the Trial', exact: true }),
  ).toBeEnabled();
  await page.reload();
  await signIn(page);
  await expect(gameQueue(page).locator('.queue-row')).toHaveCount(3);
  await expect(gameQueue(page, WITCHER).locator('.queue-row')).toHaveCount(1);
  const dialog = await confirmation(page, WITCHER, 1);
  await expect(dialog.getByRole('heading', { name: WITCHER, exact: true })).toBeVisible();
  await expect(dialog.getByText('Passed the Trial', { exact: true })).toBeVisible();
  await expect(dialog.getByText('The World', { exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Apply 1 achievement', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Results confirmed', exact: true })).toBeVisible();
  await expect(gameQueue(page).locator('.queue-row')).toHaveCount(3);
  await expect(gameQueue(page, WITCHER)).toHaveCount(0);
  const saved = await savedDemo(page);
  expect(saved.records).toHaveLength(1);
  expect(saved.records[0]?.game_id).toBe('2');
  expect(saved.records[0]?.report?.results.map((item) => item.achievement_id)).toEqual(['201']);
  expect(
    saved.queues.find((queue) => queue.game.id === '1')?.items.map((item) => item.achievement_id),
  ).toEqual(['1', '2', '3']);
  expect(saved.queues.find((queue) => queue.game.id === '2')?.items).toHaveLength(0);
  await page.getByRole('button', { name: 'History', exact: true }).click();
  await expect(
    page.getByRole('list', { name: 'Unlocked achievements', exact: true }),
  ).toContainText(WITCHER);
  await expect(
    page.getByRole('button', { name: 'Edit date for The World', exact: true }),
  ).toBeEnabled();
  await page.reload();
  await signIn(page);
  await expect(gameQueue(page).locator('.queue-row')).toHaveCount(3);
  await expect(gameQueue(page, WITCHER)).toHaveCount(0);
  expect((await savedDemo(page)).records).toHaveLength(1);
});

test('desktop, minimum desktop and mobile workspaces keep date and apply modals within viewport', async ({
  page,
}, testInfo) => {
  await signIn(page);
  for (const viewport of [
    { width: 1586, height: 992 },
    { width: 1120, height: 720 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(applyButton(page)).toBeEnabled();
    const dimensions = await page.evaluate(() => ({
      content: document.documentElement.scrollWidth,
      viewport: document.documentElement.clientWidth,
    }));
    expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport + 1);
    await page.screenshot({ path: testInfo.outputPath('workspace-' + viewport.width + '.png') });
  }
  await page
    .getByRole('complementary', { name: 'Achievement queue', exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('queue-390.png') });
  await page.getByRole('button', { name: 'Edit date for The World', exact: true }).click();
  const dateDialog = page.getByRole('dialog', { name: 'Edit unlock date', exact: true });
  await expect(dateDialog).toBeVisible();
  expect((await dateDialog.boundingBox())?.width).toBeLessThanOrEqual(390);
  await expect(
    dateDialog.getByRole('button', { name: 'Use current time', exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('date-modal-390.png') });
  await dateDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  const dialog = await confirmation(page);
  expect((await dialog.boundingBox())?.width).toBeLessThanOrEqual(390);
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
  await expect(page.getByRole('button', { name: 'Sign in with GOG', exact: true })).toHaveCount(0);
});

test('signed-out layout has a blank library and no queue or time zone controls', async ({
  page,
}, testInfo) => {
  await expect(
    page.getByRole('heading', { name: 'Your GOG achievements', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in with GOG', exact: true })).toBeEnabled();
  await expect(
    page.getByRole('complementary', { name: 'Achievement queue', exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: /^Time zone/ })).toHaveCount(0);
  await expect(page.getByLabel('Search your library', { exact: true })).toBeDisabled();
  await expect(page.locator('.library-pane .game-row')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'History', exact: true })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('signed-out-1586.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);
  await page.screenshot({ path: testInfo.outputPath('signed-out-390.png') });
});

test('Use current time saves one queued date at click time without applying achievements', async ({
  page,
}) => {
  await signIn(page);
  await page.getByRole('button', { name: 'Edit date for The World', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit unlock date', exact: true });
  const before = await page.evaluate(() => Math.floor(Date.now() / 1000));
  await dialog.getByRole('button', { name: 'Use current time', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const after = await page.evaluate(() => Math.floor(Date.now() / 1000));
  const saved = await savedDemo(page);
  const queue = saved.queues.find((item) => item.game.id === '1');
  const iso = queue?.items.find((item) => item.achievement_id === '1')?.unlocked_at;
  expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  const seconds = Date.parse(iso!) / 1000;
  expect(seconds).toBeGreaterThanOrEqual(before);
  expect(seconds).toBeLessThanOrEqual(after);
  expect(queue?.items).toHaveLength(3);
  expect(saved.records).toHaveLength(0);
});
