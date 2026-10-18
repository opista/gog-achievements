import { expect, type Page } from '@playwright/test';

export function title(index: number): string {
  return index === 1 ? 'Cyberpunk 2077' : `Library game ${String(index).padStart(5, '0')}`;
}

export async function openLibrary(page: Page, size: number, userId = '123456789'): Promise<void> {
  const games = Array.from({ length: size }, (_, index) => ({
    id: String(index + 1),
    title: title(index + 1),
    image: null,
  }));
  // Replace only the offline backend's fixture. Production data paths stay intact.
  await page.route('**/demo-api.ts*', async (route) => {
    const response = await route.fetch();
    const source = await response.text();
    const body = source
      .replace(/const USER_ID = ['"]123456789['"];/, `const USER_ID = ${JSON.stringify(userId)};`)
      .replace(
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
