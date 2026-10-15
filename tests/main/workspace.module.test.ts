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
  const context = await NestFactory.createApplicationContext(
    WorkspaceModule.register({
      createCli,
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
  return { context, cli, createCli, api, store, operations: context.get(OperationCoordinator) };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

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
    expect(blocked).toHaveLength(14);
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
