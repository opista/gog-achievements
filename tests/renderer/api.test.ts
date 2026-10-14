// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { getDesktopApi } from '../../src/renderer/api';
import { createDemoApi } from '../../src/shared/demo-api';
afterEach(() => {
  delete window.gogAchievements;
  window.history.replaceState({}, '', '/');
  vi.restoreAllMocks();
});
it('uses the native bridge even when a demo query is present', async () => {
  const bridge = createDemoApi({ delayMs: 0 });
  window.gogAchievements = bridge;
  window.history.replaceState({}, '', '?demo=1');
  expect(await getDesktopApi()).toBe(bridge);
});
it('requires an explicit browser demo flag', async () => {
  await expect(getDesktopApi()).rejects.toThrow('desktop bridge is unavailable');
  window.history.replaceState({}, '', '?demo=1');
  const demo = await getDesktopApi();
  expect(demo.isDemo).toBe(true);
  expect((await demo.initialize()).auth.authenticated).toBe(false);
});
it('never silently substitutes demo data for a missing Electron bridge', async () => {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Electron/44.7.2');
  window.history.replaceState({}, '', '?demo=1');
  await expect(getDesktopApi()).rejects.toThrow('desktop bridge is unavailable');
});
