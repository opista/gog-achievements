import { expect, test, type Page } from '@playwright/test';
import type { OperationRecord, Queue } from '../../src/shared/api';

const STORAGE_KEY = 'gog-achievements-demo:v1';
const CYBERPUNK = 'Cyberpunk 2077';
const WITCHER = 'The Witcher 3: Wild Hunt';
const browserErrors = new WeakMap<Page, string[]>();
const externalRequests = new WeakMap<Page, string[]>();

function rows(page: Page) {
  return page.locator('.achievement-list .achievement-name');
}

function search(page: Page) {
  return page.getByRole('textbox', { name: 'Search achievements', exact: true });
}

function sort(page: Page) {
  return page.getByRole('combobox', { name: 'Sort achievements', exact: true });
}

function gameQueue(page: Page, title = CYBERPUNK) {
  return page.getByRole('region', { name: `Queue for ${title}`, exact: true });
}

async function savedDemo(page: Page): Promise<{ queues: Queue[]; records: OperationRecord[] }> {
  await expect(page.getByRole('button', { name: 'History', exact: true })).toBeEnabled();
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), STORAGE_KEY);
}

test.beforeEach(async ({ page, baseURL }) => {
  const errors: string[] = [];
  const blocked: string[] = [];
  browserErrors.set(page, errors);
  externalRequests.set(page, blocked);
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') errors.push(message.text());
  });
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.origin === new URL(baseURL!).origin) return route.continue();
    blocked.push(url.origin);
    return route.abort();
  });
  await page.goto('/?demo=1&theme=light');
  await expect(page).toHaveTitle('GOG Achievements');
  await expect(page.getByText('DEMO DATA', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Sign in with GOG', exact: true }).click();
  await expect(rows(page)).toHaveCount(7);
});

test.afterEach(async ({ page }) => {
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
  expect(browserErrors.get(page), 'No browser errors or warnings').toEqual([]);
  expect(externalRequests.get(page), 'No external requests').toEqual([]);
});

for (const viewport of [
  { name: 'desktop', width: 1586, height: 992 },
  { name: 'mobile', width: 390, height: 844 },
]) {
  test(`${viewport.name}: search, status and sort preserve queues and full completion totals`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    const initialQueue = await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY);
    const completion = page.locator('.game-completion');
    const completionText = await completion.textContent();
    await expect(completion).toContainText('2 of 7 achievements unlocked, 29% complete');
    const orders = {
      Default: [
        'The World',
        'Frequent Flyer',
        'The Wandering Fool',
        'Legend of The Afterlife',
        'Hidden achievement',
        'Full Body Conversion',
        'Daemon In The Shell',
      ],
      'A–Z': [
        'Daemon In The Shell',
        'Frequent Flyer',
        'Full Body Conversion',
        'Hidden achievement',
        'Legend of The Afterlife',
        'The Wandering Fool',
        'The World',
      ],
      'Newest unlocked': [
        'Full Body Conversion',
        'Daemon In The Shell',
        'The World',
        'Frequent Flyer',
        'The Wandering Fool',
        'Legend of The Afterlife',
        'Hidden achievement',
      ],
      'Queued first': [
        'The World',
        'Frequent Flyer',
        'The Wandering Fool',
        'Legend of The Afterlife',
        'Hidden achievement',
        'Full Body Conversion',
        'Daemon In The Shell',
      ],
    };
    for (const [value, names] of Object.entries(orders)) {
      await sort(page).selectOption(value);
      await expect(rows(page)).toHaveText(names);
    }
    await sort(page).selectOption('A–Z');
    await search(page).fill('  THE  ');
    await expect(rows(page)).toHaveText([
      'Daemon In The Shell',
      'Legend of The Afterlife',
      'The Wandering Fool',
      'The World',
    ]);
    await page.getByRole('button', { name: 'Locked', exact: true }).click();
    await expect(rows(page)).toHaveText([
      'Legend of The Afterlife',
      'The Wandering Fool',
      'The World',
    ]);
    await page.getByRole('button', { name: 'Unlocked', exact: true }).click();
    await expect(rows(page)).toHaveText(['Daemon In The Shell']);
    await search(page).fill(' SAMPLE ACHIEVEMENT DESCRIPTION ');
    await expect(rows(page)).toHaveText(['Daemon In The Shell', 'Full Body Conversion']);
    await page.getByRole('button', { name: 'All', exact: true }).click();
    await expect(rows(page)).toHaveCount(6);
    expect(await completion.textContent()).toBe(completionText);
    expect(await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY)).toBe(initialQueue);
    await page.getByRole('button', { name: 'Clear achievement search', exact: true }).click();
    await expect(search(page)).toBeFocused();
    await expect(rows(page)).toHaveCount(7);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    for (const control of [search(page), sort(page)]) {
      const bounds = await control.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width);
    }
    await page.screenshot({
      path: test.info().outputPath(`${viewport.name}-achievement-controls.png`),
      fullPage: true,
    });
  });
}

test('concealed details only match after reveal and then become eligible for bulk selection', async ({
  page,
}) => {
  await sort(page).selectOption('A–Z');
  for (const query of ['sample hidden', 'concealed sample description']) {
    await search(page).fill(query);
    await expect(rows(page)).toHaveCount(0);
    await expect(page.getByText('No achievements match this search and filter.')).toBeVisible();
    await expect(page.getByText('A sample hidden achievement', { exact: true })).toHaveCount(0);
  }
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
  await page.getByRole('button', { name: 'Reveal', exact: true }).click();
  await expect(rows(page).first()).toHaveText('A sample hidden achievement');
  await search(page).fill(' CONCEALED SAMPLE DESCRIPTION ');
  await page.getByRole('button', { name: 'Locked', exact: true }).click();
  await expect(rows(page)).toHaveText(['A sample hidden achievement']);
  await page.getByRole('button', { name: 'Unlock all', exact: true }).click();
  await expect(gameQueue(page).locator('.queue-row')).toHaveCount(4);
  expect((await savedDemo(page)).queues[0]!.items.map((item) => item.achievement_id)).toEqual([
    '1',
    '2',
    '3',
    '6',
  ]);
  expect((await savedDemo(page)).records).toEqual([]);
});

test('queued-first sorting responds to adding and undoing both actions while search changes keep saved requests', async ({
  page,
}) => {
  await sort(page).selectOption('Queued first');
  await search(page).fill('shell');
  await page
    .getByRole('button', { name: 'Queue lock for Daemon In The Shell', exact: true })
    .click();
  await expect(gameQueue(page).locator('.queue-row')).toHaveCount(4);
  await search(page).fill('legend');
  await page
    .getByRole('button', { name: 'Queue unlock for Legend of The Afterlife', exact: true })
    .click();
  await expect(gameQueue(page).locator('.queue-row')).toHaveCount(5);
  await page.getByRole('button', { name: 'Clear achievement search', exact: true }).click();
  await expect(rows(page)).toHaveText([
    'The World',
    'Frequent Flyer',
    'The Wandering Fool',
    'Legend of The Afterlife',
    'Daemon In The Shell',
    'Hidden achievement',
    'Full Body Conversion',
  ]);
  await page
    .getByRole('button', { name: 'Undo queued unlock for Legend of The Afterlife', exact: true })
    .click();
  await expect(rows(page)).toHaveText([
    'The World',
    'Frequent Flyer',
    'The Wandering Fool',
    'Daemon In The Shell',
    'Legend of The Afterlife',
    'Hidden achievement',
    'Full Body Conversion',
  ]);
  await page
    .getByRole('button', { name: 'Undo queued lock for Daemon In The Shell', exact: true })
    .click();
  await expect(gameQueue(page).locator('.queue-row')).toHaveCount(3);
  await expect(rows(page)).toHaveText([
    'The World',
    'Frequent Flyer',
    'The Wandering Fool',
    'Legend of The Afterlife',
    'Hidden achievement',
    'Full Body Conversion',
    'Daemon In The Shell',
  ]);
  expect((await savedDemo(page)).records).toEqual([]);
});

test('filtered bulk actions preserve saved dates and other games while removing opposite requests for the whole game', async ({
  page,
}) => {
  await page.getByRole('button', { name: WITCHER, exact: true }).click();
  await page
    .getByRole('button', { name: 'Queue unlock for Passed the Trial', exact: true })
    .click();
  await expect(gameQueue(page, WITCHER).locator('.queue-row')).toHaveCount(1);
  await page.getByRole('button', { name: CYBERPUNK, exact: true }).click();
  await page
    .getByRole('button', { name: 'Queue lock for Full Body Conversion', exact: true })
    .click();
  await expect(gameQueue(page).locator('.queue-row')).toHaveCount(4);
  const before = await savedDemo(page);
  const originalUnlocks = before.queues
    .find((queue) => queue.game.id === '1')!
    .items.filter((item) => item.action !== 'lock');
  const otherGame = before.queues.find((queue) => queue.game.id === '2');
  await sort(page).selectOption('A–Z');
  await search(page).fill(' LEGEND ');
  await page.getByRole('button', { name: 'Locked', exact: true }).click();
  await page.getByRole('button', { name: 'Unlock all', exact: true }).click();
  await expect(gameQueue(page).locator('.queue-row')).toHaveCount(4);
  await expect(gameQueue(page).getByText('Legend of The Afterlife', { exact: true })).toBeVisible();
  const unlocked = await savedDemo(page);
  const items = unlocked.queues.find((queue) => queue.game.id === '1')!.items;
  expect(items.slice(0, 3)).toEqual(originalUnlocks);
  expect(items.map((item) => item.achievement_id)).toEqual(['1', '2', '3', '4']);
  expect(unlocked.queues.find((queue) => queue.game.id === '2')).toEqual(otherGame);
  await search(page).fill(' FULL BODY ');
  await page.getByRole('button', { name: 'Unlocked', exact: true }).click();
  await page.getByRole('button', { name: 'Lock all', exact: true }).click();
  await expect(gameQueue(page).locator('.queue-row')).toHaveCount(1);
  expect(
    (await savedDemo(page)).queues.find((queue) => queue.game.id === '1')!.items,
  ).toMatchObject([{ achievement_id: '5', action: 'lock' }]);
  await search(page).fill('no matching achievement');
  await page.getByRole('button', { name: 'All', exact: true }).click();
  await expect(rows(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Unlock all', exact: true }).click();
  await expect(gameQueue(page)).toHaveCount(0);
  const after = await savedDemo(page);
  expect(after.queues.find((queue) => queue.game.id === '2')).toEqual(otherGame);
  expect(after.records).toEqual([]);
  await expect(page.locator('.game-completion')).toContainText(
    '2 of 7 achievements unlocked, 29% complete',
  );
});
