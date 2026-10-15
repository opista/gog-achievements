import { expect, test, type Page } from '@playwright/test';

const errors = new WeakMap<Page, string[]>();

function title(index: number): string {
  return index === 1 ? 'Cyberpunk 2077' : `Library game ${String(index).padStart(5, '0')}`;
}

async function openLibrary(page: Page, size: number): Promise<void> {
  const games = Array.from({ length: size }, (_, index) => ({
    id: String(index + 1),
    title: title(index + 1),
    image: null,
  }));
  // Replace only the offline backend's fixture. Production data paths stay intact.
  await page.route('**/demo-api.ts*', async (route) => {
    const response = await route.fetch();
    const source = await response.text();
    const body = source.replace(
      /const GAMES = \[[\s\S]*?\nconst NAMES =/,
      `const GAMES = ${JSON.stringify(games)};\nconst NAMES =`,
    );
    expect(body).not.toBe(source);
    await route.fulfill({ response, body });
  });
  await page.goto('/?demo=1&theme=light');
  await expect(page).toHaveTitle('GOG Achievements');
  await expect(page.getByText('DEMO DATA', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Sign in with GOG', exact: true }).click();
  await expect(page.locator('.game-heading h2')).toHaveText(title(1));
  await expect(page.getByRole('button', { name: 'Refresh library', exact: true })).toBeEnabled();
}

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

test('libraries of 100 games keep the existing list and search behavior', async ({ page }) => {
  await openLibrary(page, 100);
  await expect(page.locator('.game-row')).toHaveCount(100);
  await expect(page.locator('.virtual-game-list')).toHaveCount(0);
  const search = page.getByRole('textbox', { name: 'Search your library' });
  await search.fill('00100');
  await expect(page.locator('.game-row')).toHaveCount(1);
  await page.getByRole('button', { name: title(100), exact: true }).click();
  await expect(page.locator('.game-heading h2')).toHaveText(title(100));
  await expect(page.getByRole('button', { name: title(100), exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});

test('10,000 games mount a bounded window and search can select an unmounted game', async ({
  page,
}, testInfo) => {
  await openLibrary(page, 10000);
  const list = page.locator('.library-list');
  const rows = page.locator('.game-row');
  await expect(page.getByRole('list', { name: 'Games', exact: true })).toBeVisible();
  expect(await rows.count()).toBeLessThan(40);
  await expect(page.getByRole('button', { name: title(10000), exact: true })).toHaveCount(0);
  await expect(page.getByRole('listitem').first()).toHaveAttribute('aria-setsize', '10000');

  await list.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  const last = page.getByRole('button', { name: title(10000), exact: true });
  await expect(last).toBeInViewport();
  await last.click();
  await expect(page.locator('.game-heading h2')).toHaveText(title(10000));
  await expect(last).toBeEnabled();
  await expect(last).toHaveAttribute('aria-pressed', 'true');
  await expect(last).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath('large-library-desktop.png') });
  const offset = await list.evaluate((element) => element.scrollTop);
  await page.getByRole('button', { name: 'Refresh achievements', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Refresh library', exact: true })).toBeEnabled();
  expect(await list.evaluate((element) => element.scrollTop)).toBe(offset);

  const search = page.getByRole('textbox', { name: 'Search your library' });
  await search.fill('01000');
  await expect(rows).toHaveCount(1);
  await page.getByRole('button', { name: title(1000), exact: true }).click();
  await expect(page.locator('.game-heading h2')).toHaveText(title(1000));
  await page.getByRole('button', { name: 'Clear library search', exact: true }).click();
  await expect(search).toBeFocused();
  await expect(page.locator('.virtual-game-list')).toBeVisible();
  expect(await rows.count()).toBeLessThan(40);
  await expect(page.getByRole('button', { name: title(1), exact: true })).toBeInViewport();
  await search.fill('no such game');
  await expect(page.getByText('No games match your search.')).toBeVisible();
});

test('keyboard traversal crosses virtual windows and retains focus during pointer scrolling', async ({
  page,
}) => {
  await openLibrary(page, 1000);
  const first = page.getByRole('button', { name: title(1), exact: true });
  await first.focus();
  for (let index = 2; index <= 35; index++) {
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: title(index), exact: true })).toBeFocused();
  }
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByRole('button', { name: title(34), exact: true })).toBeFocused();
  await page.keyboard.press('End');
  const last = page.getByRole('button', { name: title(1000), exact: true });
  await expect(last).toBeFocused();
  await expect(last).toBeInViewport();
  await page.keyboard.press('Enter');
  await expect(page.locator('.game-heading h2')).toHaveText(title(1000));
  await expect(last).toBeEnabled();
  await expect(last).toBeFocused();
  await page.keyboard.press('Home');
  await expect(first).toBeFocused();
  await page.locator('.library-list').evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(last).toBeInViewport();
  await expect(first).toBeFocused();
  await page.keyboard.press('ArrowDown');
  const second = page.getByRole('button', { name: title(2), exact: true });
  await expect(second).toBeFocused();
  await expect(second).toBeInViewport();
  await page.keyboard.press('Home');
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByRole('textbox', { name: 'Search your library' })).toBeFocused();
  expect(await page.locator('.game-row').count()).toBeLessThan(40);
});

test('a large mobile library scrolls horizontally and adapts to desktop with focus intact', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openLibrary(page, 10000);
  const list = page.locator('.library-list');
  expect(await page.locator('.game-row').count()).toBeLessThan(20);
  const dimensions = await page.evaluate(() => ({
    content: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
  }));
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport);
  await list.evaluate((element) => {
    element.scrollLeft = element.scrollWidth;
  });
  const last = page.getByRole('button', { name: title(10000), exact: true });
  await expect(last).toBeInViewport();
  await last.click();
  await expect(page.locator('.game-heading h2')).toHaveText(title(10000));
  await expect(last).toBeEnabled();
  await expect(last).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath('large-library-mobile.png') });
  await page.keyboard.press('ArrowLeft');
  const previous = page.getByRole('button', { name: title(9999), exact: true });
  await expect(previous).toBeFocused();
  await expect(previous).toBeInViewport();
  await page.setViewportSize({ width: 1586, height: 992 });
  await expect(previous).toBeFocused();
  await expect(previous).toBeInViewport();
  await page.keyboard.press('ArrowDown');
  await expect(last).toBeFocused();
  await expect(last).toBeInViewport();
});
