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
  return page.getByRole('button', { name: `Review changes for ${title}`, exact: true });
}

async function signIn(page: Page) {
  await expect(page.getByRole('heading', { name: 'Get unlocking' })).toBeVisible();
  const login = page.getByRole('button', { name: 'Sign in with GOG', exact: true });
  await expect(login).toBeEnabled();
  await login.click();
  await expect(
    page.locator('.game-heading').getByRole('heading', { name: CYBERPUNK, exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'History', exact: true })).toBeEnabled();
}

test('pins keep their order, selection and separate saved preferences through refresh and reload', async ({
  page,
}, testInfo) => {
  await signIn(page);
  const titles = page.locator('.library-pane .game-title');
  const original = await titles.allTextContents();
  const savedQueue = await savedDemo(page);
  await page.getByRole('button', { name: 'Pin Hades', exact: true }).click();
  await page.getByRole('button', { name: `Pin ${WITCHER}`, exact: true }).click();
  const pinned = [
    WITCHER,
    'Hades',
    ...original.filter((title) => title !== WITCHER && title !== 'Hades'),
  ];
  await expect(titles).toHaveText(pinned);
  await expect(page.getByRole('button', { name: `Unpin ${WITCHER}`, exact: true })).toBeFocused();
  await expect(page.locator('.game-heading h2')).toHaveText(CYBERPUNK);
  expect(await savedDemo(page)).toEqual(savedQueue);
  await page.screenshot({ path: testInfo.outputPath('pinned-games-desktop.png') });

  const search = page.getByRole('textbox', { name: 'Search your library' });
  await search.fill('h');
  await expect(titles).toHaveText([WITCHER, 'Hades', 'Hollow Knight']);
  await page.getByRole('button', { name: 'Clear library search', exact: true }).click();
  await page.getByRole('button', { name: 'Refresh library', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Refresh library', exact: true })).toBeEnabled();
  await expect(titles).toHaveText(pinned);
  await expect(page.locator('.game-heading h2')).toHaveText(CYBERPUNK);
  await page.reload();
  await signIn(page);
  await expect(titles).toHaveText(pinned);
  await page.getByLabel('Account menu', { exact: true }).click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await signIn(page);
  await expect(titles).toHaveText(pinned);
  await page.getByRole('button', { name: `Unpin ${WITCHER}`, exact: true }).click();
  await expect(titles).toHaveText(['Hades', ...original.filter((title) => title !== 'Hades')]);
  const stored = await page.evaluate(() =>
    localStorage.getItem('gog-achievements-demo:pinned-games:v1:123456789'),
  );
  expect(JSON.parse(stored!)).toEqual(['5']);
});

async function confirmation(page: Page, title = CYBERPUNK, count = 3) {
  await expect(applyButton(page, title)).toBeEnabled();
  await applyButton(page, title).click();
  const dialog = page.getByRole('dialog', {
    name: `Apply changes to ${count} achievement${count === 1 ? '' : 's'}?`,
    exact: true,
  });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function confirmApply(page: Page, title = CYBERPUNK, count = 3) {
  const dialog = await confirmation(page, title, count);
  await dialog
    .getByRole('button', {
      name: 'Apply changes',
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

for (const viewport of [
  { width: 1586, height: 992 },
  { width: 390, height: 844 },
]) {
  test(`achievement search and sorting preserve queues and totals at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await signIn(page);
    await page
      .getByRole('button', { name: 'Queue lock for Full Body Conversion', exact: true })
      .click();
    await expect(
      page.getByRole('button', { name: 'Undo queued lock for Full Body Conversion', exact: true }),
    ).toBeEnabled();
    const saved = await savedDemo(page);
    const completion = page.locator('.game-heading .game-completion');
    const totals = await completion.textContent();
    const rows = page.locator('.achievement-row');
    const names = rows.getByRole('heading');
    const search = page.getByRole('searchbox', { name: 'Search achievements' });
    const sort = page.getByRole('combobox', { name: 'Sort', exact: true });
    await expect(sort).toHaveValue('Locked first');
    const defaults = await names.allTextContents();
    await search.fill('THE WORLD');
    await expect(names).toHaveText(['The World']);
    await search.fill('SAMPLE ACHIEVEMENT DESCRIPTION');
    await expect(rows).toHaveCount(6);
    await page.getByRole('button', { name: 'Locked', exact: true }).click();
    await expect(rows).toHaveCount(4);
    await page.getByRole('button', { name: 'Unlocked', exact: true }).click();
    await expect(rows).toHaveCount(2);
    await page.getByRole('button', { name: 'All', exact: true }).click();
    for (const query of ['sample hidden', 'concealed sample']) {
      await search.fill(query);
      await expect(rows).toHaveCount(0);
    }
    await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
    await expect(search).toBeFocused();
    await sort.selectOption('A–Z');
    await expect(names).toHaveText([
      'Daemon In The Shell',
      'Frequent Flyer',
      'Full Body Conversion',
      'Hidden achievement',
      'Legend of The Afterlife',
      'The Wandering Fool',
      'The World',
    ]);
    await sort.selectOption('Newest unlocked');
    await expect(names.first()).toHaveText('Full Body Conversion');
    await expect(names.nth(1)).toHaveText('Daemon In The Shell');
    await sort.selectOption('Queued first');
    await expect(names).toHaveText([
      'The World',
      'Frequent Flyer',
      'The Wandering Fool',
      'Full Body Conversion',
      'Legend of The Afterlife',
      'Hidden achievement',
      'Daemon In The Shell',
    ]);
    await sort.selectOption('Locked first');
    await expect(names).toHaveText(defaults);
    await expect(completion).toHaveText(totals!);
    expect(await savedDemo(page)).toEqual(saved);
    await page.getByRole('button', { name: 'Reveal', exact: true }).click();
    await search.fill('CONCEALED SAMPLE');
    await expect(names).toHaveText(['A sample hidden achievement']);
    await expect(completion).toHaveText(totals!);
    expect(await savedDemo(page)).toEqual(saved);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  });
}

test('compact library keeps game art, plain achievement details and existing unlock protection', async ({
  page,
}) => {
  await signIn(page);
  const world = page.locator('.achievement-row').filter({ hasText: 'The World' });
  const unlocked = page.locator('.achievement-row').filter({ hasText: 'Full Body Conversion' });
  await expect(world.getByText('The World', { exact: true })).toBeVisible();
  await expect(world.getByText(/Sample achievement description/)).toBeVisible();
  await expect(
    world.getByRole('button', { name: 'Undo queued unlock for The World' }),
  ).toBeEnabled();
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  await expect(
    unlocked.getByRole('button', { name: 'Queue lock for Full Body Conversion' }),
  ).toBeEnabled();
  await expect(
    page.getByRole('button', { name: 'Queue unlock for Legend of The Afterlife', exact: true }),
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
  await expect(page.getByRole('heading', { name: 'Get unlocking' })).toBeVisible();
  await expect(page.locator('.queue-game-group')).toHaveCount(0);
});

test('quiet actions preserve descriptions and undo saved requests without applying', async ({
  page,
}) => {
  await signIn(page);
  const world = page.getByRole('article', { name: 'The World', exact: true });
  const conversion = page.getByRole('article', { name: 'Full Body Conversion', exact: true });
  await expect(world.getByText(/Sample achievement description/)).toBeVisible();
  await world
    .getByRole('button', { name: 'Undo queued unlock for The World', exact: true })
    .click();
  await expect(
    world.getByRole('button', { name: 'Queue unlock for The World', exact: true }),
  ).toBeEnabled();
  await expect(gameQueue(page).getByText('The World', { exact: true })).toHaveCount(0);
  expect((await savedDemo(page)).queues[0]!.items.some((item) => item.achievement_id === '1')).toBe(
    false,
  );
  await world.getByRole('button', { name: 'Queue unlock for The World', exact: true }).click();
  await expect(gameQueue(page).getByText('The World', { exact: true })).toBeVisible();

  await conversion
    .getByRole('button', { name: 'Queue lock for Full Body Conversion', exact: true })
    .click();
  const relocks = gameQueue(page).getByRole('region', {
    name: `Lock requests for ${CYBERPUNK}`,
    exact: true,
  });
  await expect(relocks.getByText('Full Body Conversion', { exact: true })).toBeVisible();
  await expect(relocks.getByText(/Sample achievement description/)).toBeVisible();
  await expect(conversion.getByText(/Sample achievement description/)).toBeVisible();
  await conversion
    .getByRole('button', { name: 'Undo queued lock for Full Body Conversion', exact: true })
    .click();
  await expect(relocks).toHaveCount(0);
  await expect(
    conversion.getByRole('button', { name: 'Queue lock for Full Body Conversion', exact: true }),
  ).toBeEnabled();
  await expect(conversion.getByText(/Sample achievement description/)).toBeVisible();
  expect((await savedDemo(page)).records).toHaveLength(0);
});

test('bulk actions choose one direction, keep matching dates and still require review', async ({
  page,
}) => {
  await signIn(page);
  const initialDates = await gameQueue(page)
    .getByRole('button', { name: /^Edit date/ })
    .evaluateAll((buttons) => buttons.map((button) => button.getAttribute('title')));
  await page.getByRole('button', { name: 'Locked', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Lock all', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Unlock all', exact: true }).click();
  await expect(gameQueue(page).locator('.queue-row')).toHaveCount(4);
  await expect(page.getByRole('button', { name: 'Unlock all', exact: true })).toBeDisabled();
  expect(
    await gameQueue(page)
      .getByRole('button', { name: /^Edit date/ })
      .evaluateAll((buttons) => buttons.slice(0, 3).map((button) => button.getAttribute('title'))),
  ).toEqual(initialDates);
  await expect(page.getByText('A sample hidden achievement', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Reveal', exact: true }).click();
  await page.getByRole('button', { name: 'Unlock all', exact: true }).click();
  await expect(gameQueue(page).locator('.queue-row')).toHaveCount(5);
  await page.getByRole('button', { name: 'Unlocked', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Unlock all', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Lock all', exact: true }).click();
  await expect(gameQueue(page).locator('.queue-row')).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Lock all', exact: true })).toBeDisabled();
  await expect(applyButton(page)).toBeEnabled();
  const saved = await savedDemo(page);
  expect(saved.records).toHaveLength(0);
  expect(saved.queues[0]!.items).toHaveLength(2);
  expect(saved.queues[0]!.items.filter((item) => item.action === 'lock')).toHaveLength(2);
  const dialog = await confirmation(page, CYBERPUNK, 2);
  await expect(dialog.locator('time')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Lock all', exact: true })).toBeDisabled();
  expect(await savedDemo(page)).toEqual(saved);
  await page.getByRole('button', { name: 'Locked', exact: true }).click();
  await page.getByRole('button', { name: 'Unlock all', exact: true }).click();
  await expect(gameQueue(page).locator('.queue-row')).toHaveCount(5);
  await expect(applyButton(page)).toBeEnabled();
  const unlocked = await savedDemo(page);
  expect(unlocked.queues[0]!.items.every((item) => item.action !== 'lock')).toBe(true);
  expect(unlocked.records).toHaveLength(0);
});

test('clear queue removes saved requests for every game without changing achievements or history', async ({
  page,
}) => {
  await signIn(page);
  await page.getByRole('button', { name: 'Lock all', exact: true }).click();
  await expect(gameQueue(page).locator('.queue-row')).toHaveCount(2);
  await page.getByRole('button', { name: WITCHER, exact: true }).click();
  await page.getByRole('button', { name: 'Unlock all', exact: true }).click();
  await expect(gameQueue(page, WITCHER).locator('.queue-row')).toHaveCount(4);
  await gameQueue(page)
    .getByRole('button', { name: `Clear queue for ${CYBERPUNK}`, exact: true })
    .click();
  await expect(gameQueue(page)).toHaveCount(0);
  await expect(gameQueue(page, WITCHER).locator('.queue-row')).toHaveCount(4);
  await expect(applyButton(page, WITCHER)).toBeEnabled();
  expect(
    (await savedDemo(page)).queues
      .filter((queue) => queue.items.length)
      .map((queue) => queue.game.id),
  ).toEqual(['2']);
  await page.getByRole('button', { name: 'Clear queue', exact: true }).click();
  await expect(page.getByText('Queue is empty.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Clear queue', exact: true })).toBeDisabled();
  await expect(page.getByRole('heading', { name: 'Queue', exact: true })).toBeFocused();
  const saved = await savedDemo(page);
  expect(saved.queues.flatMap((queue) => queue.items)).toEqual([]);
  expect(saved.records).toHaveLength(0);
  await page.reload();
  await signIn(page);
  await expect(page.getByText('Queue is empty.', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Queue unlock for The World', exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole('button', { name: 'Queue lock for Full Body Conversion', exact: true }),
  ).toBeEnabled();
});

for (const mode of ['unlock', 'lock', 'mixed'] as const) {
  test(`${mode}: reviews two actions of each selected type and confirms only after consent`, async ({
    page,
  }) => {
    if (mode === 'lock') await page.setViewportSize({ width: 390, height: 844 });
    await signIn(page);
    const removed =
      mode === 'lock'
        ? ['The World', 'Frequent Flyer', 'The Wandering Fool']
        : ['The Wandering Fool'];
    for (const name of removed) {
      const remove = page.getByRole('button', { name: `Remove ${name} from queue`, exact: true });
      await expect(remove).toBeEnabled();
      await remove.click();
      await expect(remove).toHaveCount(0);
    }
    if (mode !== 'unlock') {
      for (const name of ['Full Body Conversion', 'Daemon In The Shell']) {
        const lock = page.getByRole('button', { name: `Queue lock for ${name}`, exact: true });
        await expect(lock).toBeEnabled();
        await lock.click();
        const relocks = gameQueue(page).getByRole('region', {
          name: `Lock requests for ${CYBERPUNK}`,
          exact: true,
        });
        const queued = relocks.locator('.queue-row').filter({ hasText: name });
        await expect(relocks.getByText('Lock', { exact: true })).toBeVisible();
        await expect(queued.getByText(/Sample achievement description/)).toBeVisible();
        await expect(queued.getByRole('button', { name: /^Edit date/ })).toHaveCount(0);
      }
    }
    const count = mode === 'mixed' ? 4 : 2;
    await expect(applyButton(page)).toBeEnabled();
    const before = await savedDemo(page);
    const dialog = await confirmation(page, CYBERPUNK, count);
    const buttonLabel = 'Apply changes';
    await expect(dialog.getByRole('button', { name: buttonLabel, exact: true })).toBeEnabled();
    expect((await savedDemo(page)).records).toHaveLength(0);
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    expect(await savedDemo(page)).toEqual(before);
    await confirmation(page, CYBERPUNK, count);
    await page.screenshot({
      path: test.info().outputPath(`${mode}-confirmation.png`),
      fullPage: true,
    });
    await dialog.getByRole('button', { name: buttonLabel, exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Changes applied', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(gameQueue(page)).toHaveCount(0);
    const saved = await savedDemo(page);
    expect(saved.records).toHaveLength(1);
    const results = saved.records[0]!.report!.results;
    expect(results.filter((item) => item.status === 'restored')).toHaveLength(
      mode === 'lock' ? 0 : 2,
    );
    const locks = results.filter((item) => item.action === 'lock');
    expect(locks).toHaveLength(mode === 'unlock' ? 0 : 2);
    for (const item of locks)
      expect(item).toMatchObject({
        status: 'locked',
        previous_unlocked_at: '2026-10-04T11:00:00+0000',
        actual_unlocked_at: null,
      });
    await page.getByRole('button', { name: 'History', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Achievement history', exact: true }),
    ).toBeVisible();
    if (mode !== 'unlock')
      await expect(
        page
          .getByRole('list', { name: 'Confirmed changes', exact: true })
          .getByText('Locked', { exact: true }),
      ).toHaveCount(2);
    await page.screenshot({ path: test.info().outputPath(`${mode}-history.png`), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.reload();
    await signIn(page);
    if (mode !== 'unlock') {
      const daemon = page.getByRole('article', { name: 'Daemon In The Shell', exact: true });
      await expect(daemon.getByRole('img', { name: 'Locked', exact: true })).toBeVisible();
      await expect(
        daemon.getByRole('button', { name: 'Queue unlock for Daemon In The Shell', exact: true }),
      ).toBeEnabled();
    }
  });
}

test('single-item date edits stay local until Save date and persist exact seconds', async ({
  page,
}) => {
  await signIn(page);
  await page
    .getByRole('button', { name: 'Queue unlock for Legend of The Afterlife', exact: true })
    .click();
  const remove = page.getByRole('button', { name: 'Remove Legend of The Afterlife from queue' });
  await expect(remove).toBeEnabled();
  await remove.click();
  await expect(remove).toHaveCount(0);
  const edit = page.getByRole('button', { name: 'Edit date for The World', exact: true });
  const originalTitle = await edit.getAttribute('title');
  await edit.click();
  const dialog = page.getByRole('dialog', { name: 'Edit unlock date', exact: true });
  const date = dialog.getByLabel('Unlock date for The World', { exact: true });
  await expect(date).toHaveAttribute('type', 'datetime-local');
  await expect(date).toHaveAttribute('step', '1');
  await expect(date).toHaveValue('2026-10-10T13:30');
  await expect(page.getByRole('combobox', { name: /^Time zone/ })).toHaveCount(0);
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
    .toBe('2020-02-02T18:14:15Z');
  expect((await savedDemo(page)).records).toHaveLength(0);
  await expect(edit).toHaveAttribute('title', 'Feb 2, 2020, 1:14:15 PM');
  await page.reload();
  await signIn(page);
  await edit.click();
  await expect(date).toHaveValue('2020-02-02T13:14:15');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect((await savedDemo(page)).records).toHaveLength(0);
});

test('the single apply confirmation can be dismissed without changing achievements or history', async ({
  page,
}) => {
  await signIn(page);
  const dialog = await confirmation(page);
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await expect(dialog.getByRole('heading', { name: CYBERPUNK, exact: true })).toBeVisible();
  await expect(dialog.getByText('The World', { exact: true })).toBeVisible();
  await expect(dialog.locator('time').first()).toHaveText('Oct 10, 2026, 1:30:00 PM');
  await expect(dialog.getByText('Unlock dates · local time', { exact: true })).toHaveCount(0);
  await expect(dialog.getByText('GOG account 123456789', { exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('note', { name: 'Before applying' })).toHaveText(
    'Close the game before applying.',
  );
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
  await expect(page.getByRole('heading', { name: 'Changes applied', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog').getByText('3 unlocked', { exact: true })).toBeVisible();
  await expect(page.getByRole('dialog').getByRole('table')).toHaveCount(0);
  await page.getByRole('dialog').getByRole('button', { name: 'View history', exact: true }).click();
  await expect(page.getByText('Queue is empty.', { exact: true })).toBeVisible();
  const history = page.getByRole('button', { name: 'History', exact: true });
  await expect(history).toBeEnabled();
  const saved = await savedDemo(page);
  expect(saved.records).toHaveLength(1);
  expect(saved.queues.find((queue) => queue.game.id === '1')?.items).toHaveLength(0);
  await expect(
    page.getByRole('heading', { name: 'Achievement history', exact: true }),
  ).toBeVisible();
  const unlocks = page.getByRole('list', { name: 'Confirmed changes', exact: true });
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
    page.getByRole('button', { name: 'Queue lock for The World', exact: true }),
  ).toBeEnabled();
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
          name: scenario === 'partial' ? 'Changes need attention' : 'Could not confirm changes',
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
      await expect(page.getByRole('button', { name: 'Done', exact: true })).toBeEnabled();
      await expect(page.getByRole('dialog')).toHaveCount(1);
      await page.getByRole('button', { name: 'Done', exact: true }).click();
      await expect(page.locator('.achievement-list')).toBeVisible();
      const history = page.getByRole('button', { name: 'History', exact: true });
      await expect(history).toBeEnabled();
      await history.click();
      const attention = page.getByRole('list', { name: 'Results needing attention', exact: true });
      await expect(attention.getByRole('listitem')).toHaveCount(scenario === 'partial' ? 2 : 1);
      const unlocks = page.getByRole('list', { name: 'Confirmed changes', exact: true });
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
  const passed = page.getByRole('button', {
    name: 'Queue unlock for Passed the Trial',
    exact: true,
  });
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
  await dialog.getByRole('button', { name: 'Apply changes', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Changes applied', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
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
  await expect(page.getByRole('list', { name: 'Confirmed changes', exact: true })).toContainText(
    WITCHER,
  );
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
  await expect(page.getByRole('heading', { name: 'Get unlocking', exact: true })).toBeVisible();
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

for (const display of [
  { locale: 'en-US', date: 'Oct 4, 2026', timestamp: 'Oct 10, 2026, 1:30:00 PM' },
  { locale: 'en-GB', date: '4 Oct 2026', timestamp: '10 Oct 2026, 13:30:00' },
  { locale: 'de-DE', date: '04.10.2026', timestamp: '10.10.2026, 13:30:00' },
]) {
  test.describe('machine locale ' + display.locale, () => {
    test.use({ locale: display.locale });
    test('formats date-only badges and exact unlock times for the user locale', async ({
      page,
    }) => {
      await signIn(page);
      const unlocked = page.locator('.achievement-row').filter({ hasText: 'Full Body Conversion' });
      await expect(unlocked.getByRole('img', { name: 'Unlocked', exact: true })).toBeVisible();
      await expect(unlocked.locator('.achievement-unlock-date time')).toHaveText(display.date);
      await expect(
        page.getByRole('button', { name: 'Edit date for The World', exact: true }),
      ).toHaveAttribute('title', display.timestamp);
      const dialog = await confirmation(page);
      await expect(dialog.locator('time').first()).toHaveText(display.timestamp);
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
      expect((await savedDemo(page)).records).toHaveLength(0);
    });
  });
}

test('account menu offers update checks before and after GOG sign-in', async ({ page }) => {
  await page.getByLabel('Account menu').click();
  const check = page.getByRole('button', { name: 'Check for updates…', exact: true });
  await expect(check).toBeEnabled();
  await check.click();
  await expect(page.locator('.account-popover').getByRole('alert')).toHaveText(
    'Update checks are available in the installed app.',
  );
  await expect(page.locator('.error-banner')).toHaveCount(0);
  await page.getByLabel('Account menu').click();
  await signIn(page);
  await page.getByLabel('Account menu').click();
  await expect(check).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeEnabled();
});

test('account menu dismisses with Escape, outside clicks and keyboard focus changes', async ({
  page,
}) => {
  const menu = page.getByLabel('Account menu');
  const popover = page.locator('.account-popover');
  await menu.click();
  await expect(popover).toBeVisible();
  await menu.press('Escape');
  await expect(popover).toBeHidden();
  await expect(menu).toBeFocused();
  await menu.click();
  await page.getByRole('heading', { name: 'GOG Achievements', exact: true }).click();
  await expect(popover).toBeHidden();
  await menu.click();
  await page.getByRole('button', { name: 'Check for updates…', exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect(popover).toBeHidden();
});

test('keyboard queue actions keep their place and the empty queue explains how to add', async ({
  page,
}) => {
  await signIn(page);
  const add = page.getByRole('button', {
    name: 'Queue unlock for Legend of The Afterlife',
    exact: true,
  });
  await add.focus();
  await add.press('Enter');
  await expect(
    page.getByRole('button', {
      name: 'Undo queued unlock for Legend of The Afterlife',
      exact: true,
    }),
  ).toBeFocused();
  const remove = page.getByRole('button', { name: /^Remove .+ from queue$/ });
  while (await remove.count()) {
    const count = await remove.count();
    const button = remove.last();
    await expect(button).toBeEnabled();
    await button.focus();
    await button.press('Enter');
    await expect(remove).toHaveCount(count - 1);
  }
  const queue = page.getByRole('complementary', { name: 'Achievement queue' });
  await expect(queue.getByRole('heading', { name: 'Queue', exact: true })).toBeFocused();
  await expect(
    queue.getByText('Use the buttons beside achievements to add them here.', { exact: true }),
  ).toBeVisible();
});
