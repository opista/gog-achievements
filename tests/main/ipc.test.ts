import { afterEach, expect, test, vi } from 'vitest';
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { createIpcApp, type Constructor } from '@electron-ipc-bridge/core';
import { setupPreload } from '@electron-ipc-bridge/core/preload';
import { createDesktopApplication, type DesktopApplication } from '../../src/main/application';
import { CliClient } from '../../src/main/cli-client';
import { WorkspaceService } from '../../src/main/workspace.service';
import { RecoveryService } from '../../src/main/features/recovery/recovery.service';
import { WorkspaceModule } from '../../src/main/workspace.module';
import { DesktopModule } from '../../src/main/desktop.module';
import { WorkspaceController } from '../../src/main/workspace.controller';
import { APP_ACTIONS, DESKTOP_WINDOW, WORKSPACE_API } from '../../src/main/ipc.tokens';
import { FakeCli, gameId, userId } from './fixtures';
import { ipcSchemas } from '../../src/shared/schemas';
import type { IpcResult } from '../../src/shared/api';
import type { IpcApi } from '../../src/shared/ipc.generated';
import { createDesktopApi } from '../../src/renderer/platform/desktop-api';

const electron = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
  exposed: new Map<string, unknown>(),
  event: {} as unknown,
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown) {
      if (electron.handlers.has(channel)) throw new Error('Duplicate IPC handler.');
      electron.handlers.set(channel, listener);
    },
    removeHandler: (channel: string) => electron.handlers.delete(channel),
  },
  ipcRenderer: {
    async invoke(channel: string, ...args: unknown[]) {
      const handler = electron.handlers.get(channel);
      if (!handler) throw new Error('No IPC handler.');
      return handler(electron.event, ...args);
    },
  },
  contextBridge: {
    exposeInMainWorld: (name: string, value: unknown) => electron.exposed.set(name, value),
  },
}));

const applications: DesktopApplication[] = [];
afterEach(async () => {
  for (const application of applications.splice(0)) await application.close();
  electron.handlers.clear();
  electron.exposed.clear();
  vi.useRealTimers();
});

async function fixture(demo = true) {
  const mainFrame = {};
  const webContents = { mainFrame };
  const window = { webContents } as unknown as BrowserWindow;
  const event = { sender: webContents, senderFrame: mainFrame } as unknown as IpcMainInvokeEvent;
  electron.event = event;
  const checkForUpdates = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  const application = await createDesktopApplication({
    window,
    appActions: { checkForUpdates },
    demo,
    version: '0.1.0',
    userDataPath: '/missing-ipc-fixture',
    cli: {
      packaged: true,
      resourcesPath: '/missing-ipc-fixture',
      projectPath: '/missing-ipc-fixture',
    },
  });
  applications.push(application);
  const bridge = (await setupPreload()) as unknown as IpcApi;
  const client = createDesktopApi(bridge, {
    isDemo: demo,
    ready: async () => {},
    onOperation: (listener) => application.api.onOperation(listener),
  });
  return {
    application,
    api: application.api,
    bridge,
    client,
    checkForUpdates,
    event,
    async invoke(method: string, payload?: unknown, from = event): Promise<IpcResult> {
      electron.event = from;
      const endpoint = bridge.workspace[method as keyof IpcApi['workspace']];
      if (!endpoint) throw new Error('Unknown endpoint.');
      return (endpoint as (value?: unknown) => Promise<IpcResult>)(payload);
    },
  };
}

test('Nest and the real bridge expose only the validated workspace API', async () => {
  const run = vi.spyOn(CliClient.prototype, 'run');
  const { bridge, client } = await fixture();
  expect(electron.exposed.get('ipc')).toBe(bridge);
  expect(Object.keys(bridge.workspace).sort()).toEqual(Object.keys(ipcSchemas).sort());
  expect(bridge.workspace).not.toHaveProperty('spawn');
  expect(bridge.workspace).not.toHaveProperty('onOperation');
  expect(await client.initialize()).toMatchObject({ auth: { authenticated: false } });
  expect(run).not.toHaveBeenCalled();
});

test('IPC denies other windows and subframes before any API action', async () => {
  const { api, event, invoke } = await fixture();
  const spy = vi.spyOn(api, 'initialize');
  for (const from of [
    { ...event, senderFrame: {} },
    { ...event, sender: {} },
    { ...event, senderFrame: null },
  ]) {
    expect(await invoke('initialize', undefined, from as IpcMainInvokeEvent)).toMatchObject({
      ok: false,
      error: { code: 'IPC_DENIED' },
    });
  }
  expect(spy).not.toHaveBeenCalled();
  expect((await invoke('initialize')).ok).toBe(true);
  expect(spy).toHaveBeenCalledOnce();
});

test('IPC rejects file paths, unreviewed writes and unknown fields', async () => {
  const { api, invoke } = await fixture();
  const spy = vi.spyOn(api, 'apply');
  for (const [method, payload] of [
    ['apply', { previewToken: randomUUID(), file: '/arbitrary/queue.json' }],
    ['apply', { gameId: '1', yes: true }],
    ['initialize', { extra: true }],
    ['setDates', { gameId: '1', dates: { '1': '2999-01-01T00:00:00Z' } }],
    ['addAchievements', { gameId: '1', achievementIds: [1] }],
  ] as const) {
    expect(await invoke(method, payload)).toMatchObject({
      ok: false,
      error: { code: 'INVALID_INPUT' },
    });
  }
  await expect(invoke('spawn', { command: 'rm' })).rejects.toThrow('Unknown endpoint');
  expect(spy).not.toHaveBeenCalled();
});

test('IPC preserves sanitized error codes through the generated preload and renderer adapter', async () => {
  const { api, client, invoke } = await fixture();
  const token = randomUUID();
  const apply = vi
    .spyOn(api, 'apply')
    .mockResolvedValue({ operationId: token, state: 'unknown', report: null });
  expect(await client.apply({ previewToken: token })).toEqual({
    operationId: token,
    state: 'unknown',
    report: null,
  });
  expect(apply).toHaveBeenCalledWith({ previewToken: token });
  vi.spyOn(api, 'initialize').mockRejectedValue(
    new Error('https://auth.gog.com/?code=fixture-private'),
  );
  const failure = await invoke('initialize');
  expect(failure.ok).toBe(false);
  expect(JSON.stringify(failure)).not.toContain('fixture-private');
  expect(JSON.stringify(failure)).not.toContain('auth.gog.com');
  await expect(client.listAchievements('../invalid')).rejects.toMatchObject({
    code: 'INVALID_INPUT',
  });
});

test('IPC keeps account-local queues and validates optional history game IDs', async () => {
  const { api, invoke } = await fixture();
  const queues = vi.spyOn(api, 'listQueues').mockResolvedValue([]);
  const history = vi.spyOn(api, 'history').mockResolvedValue([]);
  expect((await invoke('listQueues')).ok).toBe(true);
  expect(queues).toHaveBeenCalledOnce();
  expect((await invoke('history', {})).ok).toBe(true);
  expect(history).toHaveBeenLastCalledWith({});
  expect((await invoke('history', { gameId: '2' })).ok).toBe(true);
  expect(history).toHaveBeenLastCalledWith({ gameId: '2' });
  for (const [method, payload] of [
    ['listQueues', { userId: '998877' }],
    ['history', { userId: '998877' }],
    ['history', { gameId: 2 }],
    ['history', { gameId: '../arbitrary' }],
    ['history', undefined],
  ] as const)
    expect((await invoke(method, payload)).ok).toBe(false);
  expect(queues).toHaveBeenCalledOnce();
  expect(history).toHaveBeenCalledTimes(2);
});

test('IPC permits only trusted, no-payload update checks without GOG sign-in', async () => {
  const { checkForUpdates, event, client, invoke } = await fixture();
  expect(
    await invoke('checkForUpdates', undefined, { ...event, senderFrame: {} } as IpcMainInvokeEvent),
  ).toMatchObject({ ok: false, error: { code: 'IPC_DENIED' } });
  for (const payload of [null, 'https://example.com', { url: 'https://example.com' }]) {
    expect(await invoke('checkForUpdates', payload)).toMatchObject({
      ok: false,
      error: { code: 'INVALID_INPUT' },
    });
  }
  expect(checkForUpdates).not.toHaveBeenCalled();
  await client.checkForUpdates();
  expect(checkForUpdates).toHaveBeenCalledExactlyOnceWith();
});

test('closing the Nest application removes all bridge handlers and permits a clean restart', async () => {
  const { application, bridge } = await fixture();
  expect(electron.handlers.size).toBe(Object.keys(ipcSchemas).length + 1);
  const closing = application.close();
  expect(application.close()).toBe(closing);
  await closing;
  expect(electron.handlers.size).toBe(0);
  await expect(bridge.workspace.initialize()).rejects.toThrow('No IPC handler');
  const next = await fixture();
  expect(await next.client.initialize()).toMatchObject({ auth: { authenticated: false } });
});

test('Nest supplies the production workspace services and stops recovery polling on close', async () => {
  vi.useFakeTimers();
  const refresh = vi.spyOn(RecoveryService.prototype, 'refresh').mockResolvedValue();
  const { application, api } = await fixture(false);
  expect(api).toBeInstanceOf(WorkspaceService);
  await vi.advanceTimersByTimeAsync(3000);
  expect(refresh).toHaveBeenCalledOnce();
  await application.close();
  await vi.advanceTimersByTimeAsync(6000);
  expect(refresh).toHaveBeenCalledOnce();
});

test('the production feature services complete the workspace flow through the real IPC bridge', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'gog-production-ipc-'));
  const cli = new FakeCli();
  const mainFrame = {};
  const webContents = { mainFrame };
  electron.event = { sender: webContents, senderFrame: mainFrame };
  const context = await NestFactory.createApplicationContext(
    {
      module: DesktopModule,
      imports: [
        WorkspaceModule.register({
          createCli: () => cli,
          userDataPath: folder,
          version: '0.1.0',
          cliVersion: '0.3.0',
          probe: { find: async () => ({ state: 'gone' }) },
        }),
      ],
      providers: [
        { provide: DESKTOP_WINDOW, useValue: { webContents } },
        { provide: APP_ACTIONS, useValue: { checkForUpdates: async () => {} } },
      ],
    },
    { logger: false, abortOnError: false },
  );
  const ipc = createIpcApp({
    controllers: [WorkspaceController] as Constructor<WorkspaceController>[],
    resolver: { resolve: (token) => context.get(token) },
  });
  try {
    const api = context.get<WorkspaceService>(WORKSPACE_API);
    const bridge = (await setupPreload()) as unknown as IpcApi;
    const client = createDesktopApi(bridge, {
      isDemo: false,
      ready: async () => {},
      onOperation: (listener) => api.onOperation(listener),
    });
    const events: string[] = [];
    const unsubscribe = client.onOperation(({ kind }) => events.push(kind));
    expect((await client.initialize()).auth.user_id).toBe(userId);
    expect((await client.login()).authenticated).toBe(true);
    expect((await client.listGames()).games[0]?.id).toBe(gameId);
    expect((await client.listAchievements(gameId)).achievements.length).toBeGreaterThan(0);
    await client.addAchievements({ gameId, achievementIds: ['101'] });
    await client.setDates({ gameId, dates: { '101': '2020-02-01T00:00:00Z' } });
    const preview = await client.preview({ gameId });
    expect(cli.calls.some(({ kind }) => kind === 'queue-apply')).toBe(false);
    expect((await client.apply({ previewToken: preview.token })).report?.complete).toBe(true);
    expect((await client.listQueues()).length).toBe(0);
    expect((await client.history({}))[0]?.report?.results[0]?.requested_unlocked_at).toBe(
      '2020-02-01T00:00:00Z',
    );
    expect(events).toContain('login');
    expect(events).toContain('apply');
    expect(events.at(-1)).toBe('idle');
    expect(cli.calls.filter(({ kind }) => kind === 'queue-apply')).toHaveLength(1);
    unsubscribe();
  } finally {
    ipc.dispose();
    await context.close();
    await rm(folder, { recursive: true, force: true });
  }
});
