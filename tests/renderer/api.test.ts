// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { getDesktopApi } from '../../src/renderer/api';
import type { IpcApi } from '../../src/shared/ipc.generated';

afterEach(() => {
  delete window.gogPlatform;
  Reflect.deleteProperty(window, 'ipc');
  window.history.replaceState({}, '', '/');
  vi.restoreAllMocks();
});

function platform() {
  window.gogPlatform = {
    isDemo: false,
    ready: vi.fn<() => Promise<void>>().mockResolvedValue(),
    onOperation: vi.fn().mockReturnValue(() => {}),
  };
  const initialize = vi.fn().mockResolvedValue({ ok: true, data: { version: 'fixture' } });
  window.ipc = { workspace: { initialize } } as unknown as IpcApi;
  return { initialize };
}

it('uses the native bridge even when a demo query is present', async () => {
  const { initialize } = platform();
  window.history.replaceState({}, '', '?demo=1');
  const api = await getDesktopApi();
  expect(api.isDemo).toBe(false);
  expect(await api.initialize()).toEqual({ version: 'fixture' });
  expect(initialize).toHaveBeenCalledExactlyOnceWith();
});

it('waits for preload contract discovery before using generated methods', async () => {
  platform();
  Reflect.deleteProperty(window, 'ipc');
  let ready!: () => void;
  window.gogPlatform!.ready = () =>
    new Promise<void>((resolve) => {
      ready = resolve;
    });
  const initialized = vi.fn();
  const pending = getDesktopApi().then(initialized);
  await Promise.resolve();
  expect(initialized).not.toHaveBeenCalled();
  const { initialize } = platform();
  ready();
  await pending;
  expect(initialized).toHaveBeenCalledOnce();
  expect(initialize).not.toHaveBeenCalled();
});

it('reports a failed native preload instead of substituting sample data', async () => {
  platform();
  window.history.replaceState({}, '', '?demo=1');
  window.gogPlatform!.ready = async () => {
    throw new Error('The desktop bridge could not load.');
  };
  await expect(getDesktopApi()).rejects.toThrow('desktop bridge could not load');
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

it('restores public error codes and hides transport diagnostics', async () => {
  const { initialize } = platform();
  const api = await getDesktopApi();
  initialize.mockResolvedValueOnce({
    ok: false,
    error: { code: 'BUSY', message: 'Wait for the current operation.' },
  });
  await expect(api.initialize()).rejects.toMatchObject({
    code: 'BUSY',
    message: 'Wait for the current operation.',
  });
  initialize.mockRejectedValueOnce(new Error('/private/native/details'));
  await expect(api.initialize()).rejects.toThrow('The desktop service did not return a result.');
});
