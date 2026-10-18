import { expect, test, type Page } from '@playwright/test';
import { openLibrary, title } from './library-fixtures';

const USER = '123456789';
const key = (userId = USER) => `gog-achievements.library-pins:v1:${userId}`;
const errors = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page, baseURL }) => {
  const messages: string[] = [];
  errors.set(page, messages);
  page.on('pageerror', (error) => messages.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') messages.push(message.text());
  });
  await page.route('**/*', (route) => {
    if (new URL(route.request().url()).origin === new URL(baseURL!).origin) return route.continue();
    messages.push(`Unexpected external request: ${route.request().url()}`);
    return route.abort();
  });
});

test.afterEach(async ({ page }) => {
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
  expect(errors.get(page) ?? [], 'No runtime errors or external requests').toEqual([]);
});

test('pins keep source order in both groups, search both groups and preserve selection', async ({
  page,
}) => {
  await openLibrary(page, 8);
  const pin = (index: number) =>
    page.getByRole('button', { name: `Pin ${title(index)}`, exact: true });
  await pin(6).click();
  await pin(2).click();
  await expect(page.locator('.game-title')).toHaveText([2, 6, 1, 3, 4, 5, 7, 8].map(title));
  const unpin = page.getByRole('button', { name: `Unpin ${title(2)}`, exact: true });
  await expect(unpin).toHaveAttribute('aria-pressed', 'true');
  await expect(unpin).toBeFocused();
  await expect(page.getByRole('button', { name: title(1), exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.locator('.game-heading h2')).toHaveText(title(1));
  expect(await unpin.evaluate((button) => button.parentElement?.closest('button'))).toBeNull();

  const search = page.getByRole('textbox', { name: 'Search your library' });
  await search.fill('Library game');
  await expect(page.locator('.game-title')).toHaveText([2, 6, 3, 4, 5, 7, 8].map(title));
  await unpin.click();
  await expect(page.locator('.game-title')).toHaveText([6, 2, 3, 4, 5, 7, 8].map(title));
  await expect(pin(2)).toBeFocused();
  await page.getByRole('button', { name: 'Clear library search', exact: true }).click();
  await expect(search).toBeFocused();
  await expect(page.locator('.game-title')).toHaveText([6, 1, 2, 3, 4, 5, 7, 8].map(title));
  await page.getByRole('button', { name: `Unpin ${title(6)}`, exact: true }).click();
  await expect(page.locator('.game-title')).toHaveText(
    Array.from({ length: 8 }, (_, i) => title(i + 1)),
  );
});

test('pins survive refresh and restart, stay local and remain isolated by account', async ({
  page,
}) => {
  await openLibrary(page, 8);
  const before = await page.evaluate(() => localStorage.getItem('gog-achievements-demo:v1'));
  await page.getByRole('button', { name: `Pin ${title(8)}`, exact: true }).click();
  const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), key());
  expect(saved).toEqual({ version: 1, gameIds: ['8'] });
  expect(await page.evaluate(() => localStorage.getItem('gog-achievements-demo:v1'))).toBe(before);
  await page.getByRole('button', { name: 'Refresh library', exact: true }).click();
  await expect(page.getByRole('button', { name: `Unpin ${title(8)}`, exact: true })).toBeVisible();
  await expect(page.locator('.game-heading h2')).toHaveText(title(1));

  // Reload creates a fresh application and preference store over the saved local data.
  await page.reload();
  await page.getByRole('button', { name: 'Sign in with GOG', exact: true }).click();
  await expect(page.locator('.game-title').first()).toHaveText(title(8));
  await page.unroute('**/demo-api.ts*');
  await openLibrary(page, 8, '987654321');
  await expect(page.locator('.game-title').first()).toHaveText(title(1));
  await expect(page.getByRole('button', { name: `Pin ${title(8)}`, exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await page.getByRole('button', { name: `Pin ${title(3)}`, exact: true }).click();
  expect(
    await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), key('987654321')),
  ).toEqual({ version: 1, gameIds: ['3'] });
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), key())).toEqual(
    saved,
  );
  await page.unroute('**/demo-api.ts*');
  await openLibrary(page, 8);
  await expect(page.locator('.game-title').first()).toHaveText(title(8));
  await expect(page.getByRole('button', { name: `Pin ${title(3)}`, exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
});

test('10,000 games retain focus and bounded virtualization when pinning distant rows', async ({
  page,
}, testInfo) => {
  await openLibrary(page, 10000);
  const first = page.getByRole('button', { name: title(1), exact: true });
  await first.focus();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: `Pin ${title(1)}`, exact: true })).toBeFocused();
  await page.keyboard.press('End');
  const pinLast = page.getByRole('button', { name: `Pin ${title(10000)}`, exact: true });
  await expect(pinLast).toBeFocused();
  await expect(pinLast).toBeInViewport();
  await page.keyboard.press('Space');
  const unpinLast = page.getByRole('button', { name: `Unpin ${title(10000)}`, exact: true });
  await expect(unpinLast).toBeFocused();
  await expect(unpinLast).toBeInViewport();
  await expect(page.locator('.game-title').first()).toHaveText(title(10000));
  await expect(page.locator('.game-heading h2')).toHaveText(title(1));
  expect(await page.locator('.game-row').count()).toBeLessThan(40);
  await page.screenshot({ path: testInfo.outputPath('pinned-games-desktop.png') });
  await page.keyboard.press('Enter');
  await expect(pinLast).toBeFocused();
  await expect(pinLast).toBeInViewport();
  expect(await page.locator('.game-row').count()).toBeLessThan(40);

  const search = page.getByRole('textbox', { name: 'Search your library' });
  await search.fill('05000');
  await expect(page.locator('.game-row')).toHaveCount(1);
  await page.getByRole('button', { name: `Pin ${title(5000)}`, exact: true }).click();
  await page.getByRole('button', { name: 'Clear library search', exact: true }).click();
  await expect(search).toBeFocused();
  await expect(page.locator('.game-title').first()).toHaveText(title(5000));
  await expect(page.getByRole('button', { name: title(1), exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByRole('listitem').first()).toHaveAttribute('aria-setsize', '10000');
});

test('mobile pin and unpin retain focus when rows move across horizontal windows', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openLibrary(page, 10000);
  await page.locator('.library-list').evaluate((list) => {
    list.scrollLeft = list.scrollWidth;
  });
  const pin = page.getByRole('button', { name: `Pin ${title(10000)}`, exact: true });
  await pin.click();
  const unpin = page.getByRole('button', { name: `Unpin ${title(10000)}`, exact: true });
  await expect(unpin).toBeFocused();
  await expect(unpin).toBeInViewport();
  await page.keyboard.press('Enter');
  await expect(pin).toBeFocused();
  await expect(pin).toBeInViewport();
  expect(await page.locator('.game-row').count()).toBeLessThan(20);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: testInfo.outputPath('pinned-games-mobile.png') });
});
