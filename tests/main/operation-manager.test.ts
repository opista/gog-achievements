import { afterEach, expect, test } from 'vitest';
import { mkdtemp, rm, writeFile, chmod, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { OperationManager } from '../../src/main/operation-manager';
import { QueueStore, digestBytes, type StoredOperation } from '../../src/main/queue-store';
import type { ProcessProbe } from '../../src/main/process-identity';
import { FakeCli, gameId, userId, makeQueue, game } from './fixtures';
const folders: string[] = [];
afterEach(async () => {
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
});
const gone: ProcessProbe = { find: async () => ({ state: 'gone' }) };
async function fixture(probe: ProcessProbe = gone) {
  const folder = await mkdtemp(join(tmpdir(), 'gog-operations-'));
  folders.push(folder);
  const store = new QueueStore(folder);
  const cli = new FakeCli();
  const api = new OperationManager(cli, store, '0.1.0', '0.3.0', probe);
  return { folder, store, cli, api };
}
async function seed(store: QueueStore) {
  const file = await store.draftPath(userId, gameId);
  await writeFile(file, JSON.stringify(makeQueue()));
  return file;
}
async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw new Error('Expected fixture operation did not start');
}

test('startup checks exact version; browsing keeps string IDs and uses the CLI', async () => {
  const { api, cli } = await fixture();
  const startup = await api.initialize();
  expect(startup.cliVersion).toBe('0.3.0');
  expect(startup.auth.user_id).toBe(userId);
  expect((await api.listGames()).games[0]?.id).toBe(gameId);
  expect((await api.listAchievements(gameId)).game.client_id).toBe('18446744073709551615');
  expect(await api.getQueue(gameId)).toBeNull();
  expect(cli.calls.map((call) => call.kind)).toContain('doctor');
  const original = cli.run.bind(cli);
  cli.run = async (command, onSpawn) =>
    command.kind === 'help'
      ? { exitCode: 0, result: { ok: true, data: { version: '0.2.0' } } }
      : original(command, onSpawn);
  await expect(api.initialize()).rejects.toThrow('version');
});
test('queue edits make no apply call and preserve the actual saved queue', async () => {
  const { api, cli } = await fixture();
  expect(
    (await api.addAchievements({ gameId, achievementIds: ['101', '102'] })).items,
  ).toHaveLength(2);
  await api.setDates({
    gameId,
    dates: { '101': '2020-06-01T18:30:00+01:00', '102': '2020-05-01T00:00:00Z' },
  });
  const changed = await api.getQueue(gameId);
  expect(changed?.items[0]?.unlocked_at).toBe('2020-06-01T18:30:00+01:00');
  await api.removeAchievements({ gameId, achievementIds: ['102'] });
  expect((await api.getQueue(gameId))?.items.map((item) => item.achievement_id)).toEqual(['101']);
  expect(cli.calls.some((command) => command.kind === 'queue-apply')).toBe(false);
});
test('date edits reject unlocked and unknown items before any saved mutation', async () => {
  const { api, cli, store } = await fixture();
  await seed(store);
  cli.achievements[0]!.unlocked = true;
  cli.achievements[0]!.unlocked_at = '2020-01-01T00:00:00Z';
  await expect(api.setDates({ gameId, dates: { '101': '2020-01-02T00:00:00Z' } })).rejects.toThrow(
    'cannot be changed',
  );
  await expect(api.setDates({ gameId, dates: { '999': '2020-01-02T00:00:00Z' } })).rejects.toThrow(
    'not in the queue',
  );
  expect(cli.calls.some((command) => command.kind === 'queue-date')).toBe(false);
});
test('a grouped save failure retains actual prior changes and never applies', async () => {
  const { api, cli } = await fixture();
  await api.addAchievements({ gameId, achievementIds: ['101', '102'] });
  cli.failure = (command) => {
    if (command.kind === 'queue-date' && command.achievementIds.includes('102'))
      throw new Error('private');
  };
  await expect(
    api.setDates({
      gameId,
      dates: { '101': '2020-02-01T00:00:00Z', '102': '2020-03-01T00:00:00Z' },
    }),
  ).rejects.toThrow();
  const queue = await api.getQueue(gameId);
  expect(queue?.items[0]?.unlocked_at).toBe('2020-02-01T00:00:00Z');
  expect(queue?.items[1]?.unlocked_at).toBe('2020-01-01T00:00:00Z');
  expect(cli.calls.some((command) => command.kind === 'queue-apply')).toBe(false);
});
test('preview creates immutable reviewed bytes and applies exactly once after explicit token use', async () => {
  const { api, cli, store } = await fixture();
  await seed(store);
  const preview = await api.preview({ gameId });
  expect(preview.report.dry_run).toBe(true);
  expect(cli.calls.some((command) => command.kind === 'queue-apply')).toBe(false);
  const snapshot = store.snapshotPath(userId, preview.token);
  expect(digestBytes(await store.bytes(snapshot))).toBe(
    digestBytes(await store.bytes(await store.draftPath(userId, gameId))),
  );
  const result = await api.apply({ previewToken: preview.token });
  expect(result.state).toBe('complete');
  expect(result.report?.complete).toBe(true);
  const history = await api.history({ gameId });
  expect(history).toHaveLength(1);
  expect(history[0]?.report?.results[0]?.status).toBe('restored');
  expect(history[0]).not.toHaveProperty('process');
  expect(history[0]).not.toHaveProperty('digest');
  await expect(api.apply({ previewToken: preview.token })).rejects.toThrow('Preview');
  expect(cli.calls.filter((command) => command.kind === 'queue-apply')).toHaveLength(1);
});
test('draft edits, account changes and restarts invalidate prior previews', async () => {
  const { api, cli, store } = await fixture();
  const file = await seed(store);
  const first = await api.preview({ gameId });
  await api.removeAchievements({ gameId, achievementIds: ['101'] });
  await expect(api.apply({ previewToken: first.token })).rejects.toThrow('Preview');
  await seed(store);
  const second = await api.preview({ gameId });
  cli.account = '998877';
  await expect(api.apply({ previewToken: second.token })).rejects.toThrow('account changed');
  cli.account = userId;
  const third = await api.preview({ gameId });
  await expect(
    new OperationManager(cli, store, '0.1.0', '0.3.0', gone).apply({ previewToken: third.token }),
  ).rejects.toThrow('Preview');
  const fourth = await api.preview({ gameId });
  const queue = makeQueue();
  queue.items[0]!.unlocked_at = '2020-02-01T00:00:00Z';
  await writeFile(file, JSON.stringify(queue));
  await expect(api.apply({ previewToken: fourth.token })).rejects.toThrow('queue changed');
  expect(cli.calls.some((command) => command.kind === 'queue-apply')).toBe(false);
});
test('snapshot tampering prevents a write and consumes the token', async () => {
  const { api, store, cli } = await fixture();
  await seed(store);
  const preview = await api.preview({ gameId });
  const snapshot = store.snapshotPath(userId, preview.token);
  await chmod(snapshot, 0o600);
  await writeFile(snapshot, '{}');
  await expect(api.apply({ previewToken: preview.token })).rejects.toThrow('queue changed');
  expect(cli.calls.some((command) => command.kind === 'queue-apply')).toBe(false);
});
test('concurrent apply and sign-out are rejected; attempt is persisted before a child write', async () => {
  const { api, cli, store } = await fixture();
  await seed(store);
  const preview = await api.preview({ gameId });
  let finish!: () => void;
  cli.pause = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const first = api.apply({ previewToken: preview.token });
  await waitFor(() => cli.calls.some((command) => command.kind === 'queue-apply'));
  expect((await store.operations(userId))[0]?.state).toBe('running');
  await expect(api.apply({ previewToken: preview.token })).rejects.toThrow('Another operation');
  await expect(api.logout()).rejects.toThrow('Another operation');
  finish();
  await first;
  expect(api.currentOperation.kind).toBe('idle');
  expect(cli.calls.filter((command) => command.kind === 'queue-apply')).toHaveLength(1);
});
test('exit 6 persists a partial report and requires a fresh preview for another apply', async () => {
  const { api, cli, store } = await fixture();
  await seed(store);
  const preview = await api.preview({ gameId });
  cli.mode = 'partial';
  const result = await api.apply({ previewToken: preview.token });
  expect(result.state).toBe('complete');
  expect(result.report?.complete).toBe(false);
  expect(result.report?.results[0]?.status).toBe('unconfirmed');
  expect(result.error?.code).toBe('APPLY_INCOMPLETE');
  expect((await api.history({ gameId }))[0]?.report?.results[0]?.status).toBe('unconfirmed');
  await api.checkCurrentState({ gameId });
  expect(cli.calls.filter((command) => command.kind === 'queue-apply')).toHaveLength(1);
});
test.each(['transport', 'wrong-account', 'invalid-report'] as const)(
  '%s creates an unknown outcome without replay or exposed secrets',
  async (mode) => {
    const { api, cli, store } = await fixture();
    await seed(store);
    const preview = await api.preview({ gameId });
    cli.mode = mode;
    const result = await api.apply({ previewToken: preview.token });
    expect(result.state).toBe('unknown');
    expect(result.report).toBeNull();
    expect(JSON.stringify(result)).not.toContain('fixture-secret');
    const reopened = new OperationManager(cli, store, '0.1.0', '0.3.0', gone);
    await reopened.initialize();
    expect((await reopened.history({ gameId }))[0]?.state).toBe('unknown');
    expect(cli.calls.filter((command) => command.kind === 'queue-apply')).toHaveLength(1);
  },
);
test('failed record persistence prevents any launch of --yes', async () => {
  const { api, cli, store } = await fixture();
  await seed(store);
  const preview = await api.preview({ gameId });
  store.saveOperation = async () => {
    throw new Error('disk full');
  };
  await expect(api.apply({ previewToken: preview.token })).rejects.toThrow('disk full');
  expect(cli.calls.some((command) => command.kind === 'queue-apply')).toBe(false);
});
async function seedRunning(store: QueueStore): Promise<StoredOperation> {
  const id = randomUUID();
  const file = await seed(store);
  const snapshot = await store.snapshot(userId, id, file);
  const record: StoredOperation = {
    id,
    user_id: userId,
    game_id: gameId,
    game_title: game.title,
    started_at: '2020-01-01T00:00:00Z',
    finished_at: null,
    state: 'running',
    report: null,
    digest: snapshot.digest,
    process: { pid: 12345, startedAt: 'fixture-start' },
  };
  await store.saveOperation(record);
  return record;
}
test('a surviving child blocks all new CLI operations until identity checks show it ended', async () => {
  let alive = true;
  const probe: ProcessProbe = {
    find: async () =>
      alive
        ? { state: 'alive', identity: { pid: 12345, startedAt: 'fixture-start' } }
        : { state: 'gone' },
  };
  const { api, store, cli } = await fixture(probe);
  const record = await seedRunning(store);
  const startup = await api.initialize();
  expect(startup.operation.kind).toBe('recovery');
  expect(cli.calls).toHaveLength(0);
  await expect(api.logout()).rejects.toThrow('Another operation');
  await expect(api.listGames()).rejects.toThrow('Another operation');
  alive = false;
  await api.refreshRecovery();
  await api.initialize();
  expect(api.currentOperation.kind).toBe('idle');
  expect((await store.operations(userId))[0]?.state).toBe('unknown');
  expect((await api.history({ gameId }))[0]?.id).toBe(record.id);
  expect(cli.calls.some((command) => command.kind === 'queue-apply')).toBe(false);
});
test('unknown process inspection fails closed and leaves lock files untouched', async () => {
  const { api, store, cli } = await fixture({ find: async () => ({ state: 'unknown' }) });
  const record = await seedRunning(store);
  const lock = `${store.snapshotPath(userId, record.id)}.lock`;
  await writeFile(lock, '{"pid":12345}');
  expect((await api.initialize()).operation.kind).toBe('recovery');
  await expect(api.login()).rejects.toThrow('Another operation');
  expect(await readFile(lock, 'utf8')).toContain('12345');
  expect(cli.calls).toHaveLength(0);
});
test('subscription cleanup stops operation callbacks', async () => {
  const { api } = await fixture();
  const kinds: string[] = [];
  const unsubscribe = api.onOperation((state) => {
    kinds.push(state.kind);
  });
  await api.initialize();
  expect(kinds).toContain('read');
  unsubscribe();
  const count = kinds.length;
  await api.listGames();
  expect(kinds).toHaveLength(count);
});
