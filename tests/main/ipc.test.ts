import { expect, test, vi } from 'vitest';
import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from 'electron';
import { randomUUID } from 'node:crypto';
import { installIpc } from '../../src/main/ipc';
import { IPC_REQUEST, type IpcResult } from '../../src/shared/api';
import { createDemoApi } from '../../src/shared/demo-api';
type Handler = (event: IpcMainInvokeEvent, request: unknown) => Promise<IpcResult>;
function fixture() {
  let handle!: Handler;
  const mainFrame = {};
  const webContents = { mainFrame };
  const window = { webContents } as unknown as BrowserWindow;
  const ipc = {
    removeHandler: vi.fn(),
    handle(channel: string, listener: Handler) {
      expect(channel).toBe(IPC_REQUEST);
      handle = listener;
    },
  } as unknown as IpcMain;
  const api = createDemoApi({ delayMs: 0 });
  installIpc(ipc, window, api);
  const event = { sender: webContents, senderFrame: mainFrame } as unknown as IpcMainInvokeEvent;
  return { api, event, invoke: (request: unknown, from = event) => handle(from, request) };
}
test('IPC denies other windows and subframes before any API action', async () => {
  const { api, event, invoke } = fixture();
  const spy = vi.spyOn(api, 'initialize');
  expect(
    (await invoke({ method: 'initialize' }, { ...event, senderFrame: {} } as IpcMainInvokeEvent))
      .ok,
  ).toBe(false);
  expect(
    (await invoke({ method: 'initialize' }, { ...event, sender: {} } as IpcMainInvokeEvent)).ok,
  ).toBe(false);
  expect(spy).not.toHaveBeenCalled();
  expect((await invoke({ method: 'initialize' })).ok).toBe(true);
  expect(spy).toHaveBeenCalledOnce();
});
test('IPC rejects arbitrary commands, file paths, unreviewed writes and unknown fields', async () => {
  const { api, invoke } = fixture();
  const spy = vi.spyOn(api, 'apply');
  for (const request of [
    { method: 'spawn', payload: { command: 'rm' } },
    { method: '__proto__' },
    { method: 'apply', payload: { previewToken: randomUUID(), file: '/arbitrary/queue.json' } },
    { method: 'apply', payload: { gameId: '1', yes: true } },
    { method: 'initialize', extra: true },
    { method: 'setDates', payload: { gameId: '1', dates: { '1': '2999-01-01T00:00:00Z' } } },
    { method: 'addAchievements', payload: { gameId: '1', achievementIds: [1] } },
  ]) {
    expect((await invoke(request)).ok).toBe(false);
  }
  expect(spy).not.toHaveBeenCalled();
});
test('IPC keeps sanitized failures and passes only a validated opaque apply token', async () => {
  const { api, invoke } = fixture();
  const token = randomUUID();
  const spy = vi
    .spyOn(api, 'apply')
    .mockResolvedValue({ operationId: token, state: 'unknown', report: null });
  expect(await invoke({ method: 'apply', payload: { previewToken: token } })).toEqual({
    ok: true,
    data: { operationId: token, state: 'unknown', report: null },
  });
  expect(spy).toHaveBeenCalledWith({ previewToken: token });
  vi.spyOn(api, 'initialize').mockRejectedValue(
    new Error('https://auth.gog.com/?code=fixture-private'),
  );
  const failure = await invoke({ method: 'initialize' });
  expect(failure.ok).toBe(false);
  expect(JSON.stringify(failure)).not.toContain('fixture-private');
  expect(JSON.stringify(failure)).not.toContain('auth.gog.com');
});
