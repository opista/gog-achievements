import { NestFactory } from '@nestjs/core';
import { afterEach, expect, test, vi } from 'vitest';
import type { INestApplicationContext } from '@nestjs/common';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { WorkspaceModule } from '../../src/main/workspace.module';
import { WorkspaceService } from '../../src/main/workspace.service';
import { WORKSPACE_API } from '../../src/main/ipc.tokens';
import { OperationCoordinator } from '../../src/main/application/operation-coordinator';
import { QueueStore, type StoredOperation } from '../../src/main/queue-store';
import type { ProcessProbe } from '../../src/main/process-identity';
import { FakeCli, gameId, userId, makeQueue, game } from './fixtures';

const contexts: INestApplicationContext[] = [];
const folders: string[] = [];
afterEach(async () => {
  for (const context of contexts.splice(0)) await context.close();
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
});
async function fixture(probe: ProcessProbe = { find: async () => ({ state: 'gone' }) }) {
  const folder = await mkdtemp(join(tmpdir(), 'gog-workspace-module-'));
  folders.push(folder);
  const cli = new FakeCli();
  const createCli = vi.fn(async () => cli);
  const replacement = new FakeCli();
  replacement.version = '0.6.0';
  replacement.supportsExporting = true;
  const createReplacementCli = vi.fn(() => replacement);
  const context = await NestFactory.createApplicationContext(
    WorkspaceModule.register({
      createCli,
      createReplacementCli,
      userDataPath: folder,
      version: '0.1.0',
      cliVersion: '0.3.0',
      probe,
    }),
    { logger: false, abortOnError: false },
  );
  contexts.push(context);
  const api = context.get<WorkspaceService>(WORKSPACE_API);
  const store = context.get(QueueStore);
  return {
    context,
    cli,
    replacement,
    createReplacementCli,
    createCli,
    api,
    store,
    operations: context.get(OperationCoordinator),
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

function activation() {
  return {
    selection: { executable: '/fixture/0.6.0/gog-achievements', version: '0.6.0' },
    verify: vi.fn(async () => {}),
    commit: vi.fn(async () => {}),
  };
}

test('an idle workspace changes future commands and feature support without signing out', async () => {
  const f = await fixture();
  expect(await f.api.initialize()).toMatchObject({ cliVersion: '0.3.0', supportsExporting: false });
  const events: unknown[] = [];
  f.api.onOperation((event) => events.push(event));
  const update = activation();
  expect(await f.api.activateCli(update)).toBe(true);
  expect(update.verify).toHaveBeenCalledOnce();
  expect(update.commit).toHaveBeenCalledOnce();
  expect(events.at(-1)).toMatchObject({
    kind: 'idle',
    cli: { version: '0.6.0', supportsExporting: true },
  });
  const oldCalls = f.cli.calls.length;
  expect(await f.api.initialize()).toMatchObject({
    cliVersion: '0.6.0',
    supportsExporting: true,
    auth: { user_id: userId },
  });
  await f.api.listGames();
  expect(f.cli.calls).toHaveLength(oldCalls);
  expect(f.replacement.calls.some(({ kind }) => kind === 'games')).toBe(true);
  expect(f.replacement.calls.some(({ kind }) => kind === 'auth-logout')).toBe(false);
});

test('a review and its entire apply keep their original CLI and never replay after activation', async () => {
  const f = await fixture();
  await writeFile(await f.store.draftPath(userId, gameId), JSON.stringify(makeQueue()));
  const preview = await f.api.preview({ gameId });
  const update = activation();
  expect(await f.api.activateCli(update)).toBe(false);
  expect(update.verify).not.toHaveBeenCalled();
  const finish = deferred<void>();
  f.cli.pause = finish.promise;
  const applying = f.api.apply({ previewToken: preview.token });
  await vi.waitFor(() => expect(f.operations.current.kind).toBe('apply'));
  expect(await f.api.activateCli(update)).toBe(false);
  finish.resolve();
  expect((await applying).report?.complete).toBe(true);
  expect(await f.api.activateCli(update)).toBe(true);
  expect(f.cli.calls.filter(({ kind }) => kind === 'queue-apply')).toHaveLength(1);
  expect(f.replacement.calls.filter(({ kind }) => kind === 'queue-apply')).toHaveLength(0);
});

test('cancelling a review and closing a dialog release the activation guard', async () => {
  const f = await fixture();
  await writeFile(await f.store.draftPath(userId, gameId), JSON.stringify(makeQueue()));
  const preview = await f.api.preview({ gameId });
  const update = activation();
  await f.api.setCliActivationBlocked({ blocked: true });
  await f.api.cancelPreview({ previewToken: preview.token });
  expect(await f.api.activateCli(update)).toBe(false);
  await f.api.setCliActivationBlocked({ blocked: false });
  expect(await f.api.activateCli(update)).toBe(true);
  await expect(f.api.apply({ previewToken: preview.token })).rejects.toMatchObject({
    code: 'STALE_PREVIEW',
  });
  expect(f.cli.calls.some(({ kind }) => kind === 'queue-apply')).toBe(false);
});

test('failed activation leaves the current runner and feature cache intact', async () => {
  const f = await fixture();
  await f.api.initialize();
  const update = activation();
  update.commit.mockRejectedValueOnce(new Error('Disk full'));
  await expect(f.api.activateCli(update)).rejects.toThrow('Disk full');
  expect(await f.api.initialize()).toMatchObject({ cliVersion: '0.3.0', supportsExporting: false });
  expect(f.operations.current.kind).toBe('idle');
});

test('a new UI workflow waits for an activation already in progress', async () => {
  const f = await fixture();
  const finish = deferred<void>();
  const update = activation();
  update.verify.mockReturnValueOnce(finish.promise);
  const updating = f.api.activateCli(update);
  let acknowledged = false;
  const holding = f.api.setCliActivationBlocked({ blocked: true }).then(() => {
    acknowledged = true;
  });
  await Promise.resolve();
  expect(acknowledged).toBe(false);
  finish.resolve();
  expect(await updating).toBe(true);
  await holding;
  expect((await f.api.listGames()).user_id).toBe(userId);
  expect(await f.api.activateCli(activation())).toBe(false);
});

test('the Nest graph shares one operation lock across all workspace routes during a write', async () => {
  const { api, cli, store, operations, createCli } = await fixture();
  const file = await store.draftPath(userId, gameId);
  await writeFile(file, JSON.stringify(makeQueue()));
  const preview = await api.preview({ gameId });
  const started = deferred<void>();
  const finish = deferred<void>();
  cli.pause = finish.promise;
  cli.failure = ({ kind }) => {
    if (kind === 'queue-apply') started.resolve();
  };
  const applying = api.apply({ previewToken: preview.token });
  try {
    await started.promise;
    expect(api.currentOperation).toEqual(operations.current);
    expect(operations.current).toMatchObject({ kind: 'apply', gameId });
    const before = cli.calls.length;
    const blocked = await Promise.allSettled([
      api.initialize(),
      api.login(),
      api.logout(),
      api.listGames(),
      api.listAchievements(gameId),
      api.exportAchievements({ gameId }),
      api.getQueue(gameId),
      api.listQueues(),
      api.addAchievements({ gameId, achievementIds: ['102'] }),
      api.removeAchievements({ gameId, achievementIds: ['101'] }),
      api.setDates({ gameId, dates: { '101': '2020-02-01T00:00:00Z' } }),
      api.preview({ gameId }),
      api.apply({ previewToken: preview.token }),
      api.history({}),
      api.checkCurrentState({ gameId }),
    ]);
    expect(blocked).toHaveLength(15);
    for (const outcome of blocked)
      expect(outcome).toMatchObject({ status: 'rejected', reason: { code: 'BUSY' } });
    expect(cli.calls).toHaveLength(before);
  } finally {
    finish.resolve();
    await applying;
  }
  expect(operations.current.kind).toBe('idle');
  expect(createCli).toHaveBeenCalledTimes(1);
  expect((await api.history({}))[0]?.report?.complete).toBe(true);
});

test('Nest features share preview invalidation across session and queue actions', async () => {
  const { api, cli } = await fixture();
  await api.addAchievements({ gameId, achievementIds: ['101'] });
  const beforeSave = await api.preview({ gameId });
  await api.setDates({ gameId, dates: { '101': '2020-02-01T00:00:00Z' } });
  await expect(api.apply({ previewToken: beforeSave.token })).rejects.toMatchObject({
    code: 'STALE_PREVIEW',
  });
  const beforeSession = await api.preview({ gameId });
  await api.login();
  await expect(api.apply({ previewToken: beforeSession.token })).rejects.toMatchObject({
    code: 'STALE_PREVIEW',
  });
  const beforeChange = await api.preview({ gameId });
  cli.account = '998877';
  await api.initialize();
  cli.account = userId;
  await api.initialize();
  await expect(api.apply({ previewToken: beforeChange.token })).rejects.toMatchObject({
    code: 'STALE_PREVIEW',
  });
  expect(cli.calls.some(({ kind }) => kind === 'queue-apply')).toBe(false);
});

test('recovery and all features use the same coordinator before any CLI read', async () => {
  const { api, cli, store, operations } = await fixture({
    find: async () => ({ state: 'unknown' }),
  });
  const record: StoredOperation = {
    id: randomUUID(),
    user_id: userId,
    game_id: gameId,
    game_title: game.title,
    started_at: '2020-01-01T00:00:00Z',
    finished_at: null,
    state: 'running',
    report: null,
    digest: '0'.repeat(64),
    process: null,
  };
  await store.saveOperation(record);
  const startup = await api.initialize();
  expect(startup.operation).toEqual(operations.current);
  expect(startup.operation.kind).toBe('recovery');
  expect(startup.auth.authenticated).toBe(false);
  await expect(api.login()).rejects.toMatchObject({ code: 'BUSY' });
  await expect(api.listGames()).rejects.toMatchObject({ code: 'BUSY' });
  await expect(api.preview({ gameId })).rejects.toMatchObject({ code: 'BUSY' });
  expect(cli.calls).toEqual([]);
});

test('different Nest contexts keep their locks and preview stores separate', async () => {
  const first = await fixture();
  const second = await fixture();
  await first.api.addAchievements({ gameId, achievementIds: ['101'] });
  const preview = await first.api.preview({ gameId });
  await second.api.initialize();
  await expect(second.api.apply({ previewToken: preview.token })).rejects.toMatchObject({
    code: 'STALE_PREVIEW',
  });
  expect((await first.api.apply({ previewToken: preview.token })).state).toBe('complete');
  expect(second.cli.calls.some(({ kind }) => kind === 'queue-apply')).toBe(false);
});
