import { afterEach, expect, test, vi } from 'vitest';
import { mkdir, mkdtemp, open, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { PreviewStore, type PreviewSnapshot } from '../../src/main/application/preview-store';
import { QueueStore } from '../../src/main/queue-store';
import { createWorkspace } from './create-workspace';
import { FakeCli, gameId, makeQueue, makeReport, userId } from './fixtures';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, open: vi.fn(actual.open) };
});
const realFs = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
const folders: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  vi.mocked(open).mockReset().mockImplementation(realFs.open);
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
});
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function fixture() {
  const folder = await mkdtemp(join(tmpdir(), 'gog-preview-lifecycle-'));
  folders.push(folder);
  const store = new QueueStore(folder);
  const previews = new PreviewStore(store);
  const cli = new FakeCli();
  const api = createWorkspace(cli, store, '0.1.0', '0.3.0', {
    find: async () => ({ state: 'gone' }),
  });
  const queue = makeQueue();
  const draft = await store.draftPath(userId, gameId);
  await writeFile(draft, JSON.stringify(queue));
  async function create() {
    return previews.create(userId, randomUUID(), draft);
  }
  function save(snapshot: PreviewSnapshot) {
    previews.save({ ...snapshot, queue, report: makeReport(queue, true) });
  }
  return { folder, store, previews, cli, api, draft, queue, create, save };
}

test.each(['CLI failure', 'invalid report', 'wrong account'])(
  'a failed preview removes its snapshot for %s and preserves its draft',
  async (failure) => {
    const { api, cli, store, draft } = await fixture();
    const original = cli.run.bind(cli);
    let snapshot = '';
    cli.run = async (command, onSpawn) => {
      if (command.kind !== 'queue-preview') return original(command, onSpawn);
      snapshot = command.file;
      if (failure === 'CLI failure') throw new Error('Fixture preview failed');
      const report = makeReport(makeQueue(), true);
      if (failure === 'wrong account') report.user_id = '998877';
      return {
        exitCode: 0,
        result: { ok: true, data: failure === 'invalid report' ? {} : report },
      };
    };
    await expect(api.preview({ gameId })).rejects.toThrow();
    expect(snapshot).not.toBe('');
    expect(await store.exists(snapshot)).toBe(false);
    expect(JSON.parse(await readFile(draft, 'utf8'))).toEqual(makeQueue());
    expect(await store.operations()).toEqual([]);
  },
);

test('replacement and cancellation remove only unconsumed preview snapshots', async () => {
  const { api, store } = await fixture();
  const first = await api.preview({ gameId });
  const second = await api.preview({ gameId });
  expect(await store.exists(store.snapshotPath(userId, first.token))).toBe(false);
  expect(await store.exists(store.snapshotPath(userId, second.token))).toBe(true);
  await api.cancelPreview({ previewToken: first.token });
  expect(await store.exists(store.snapshotPath(userId, second.token))).toBe(true);
  await api.cancelPreview({ previewToken: second.token });
  expect(await store.exists(store.snapshotPath(userId, second.token))).toBe(false);
  await expect(api.apply({ previewToken: second.token })).rejects.toMatchObject({
    code: 'STALE_PREVIEW',
  });
});

test.each(['draft changed', 'account changed', 'nothing pending'] as const)(
  'consuming a preview releases its snapshot before any write when %s',
  async (failure) => {
    const { api, cli, store, draft } = await fixture();
    if (failure === 'nothing pending') {
      const original = cli.run.bind(cli);
      cli.run = async (command, onSpawn) => {
        const result = await original(command, onSpawn);
        if (command.kind === 'queue-preview') {
          const report = makeReport(makeQueue(), true);
          report.results[0]!.status = 'skipped_already_unlocked';
          report.results[0]!.actual_unlocked_at = report.results[0]!.requested_unlocked_at;
          return { exitCode: 0, result: { ok: true, data: report } };
        }
        return result;
      };
    }
    const preview = await api.preview({ gameId });
    if (failure === 'draft changed') await writeFile(draft, '{}');
    if (failure === 'account changed') cli.account = '998877';
    await expect(api.apply({ previewToken: preview.token })).rejects.toMatchObject({
      code: {
        'draft changed': 'STALE_PREVIEW',
        'account changed': 'ACCOUNT_CHANGED',
        'nothing pending': 'NOTHING_TO_APPLY',
      }[failure],
    });
    expect(await store.exists(store.snapshotPath(userId, preview.token))).toBe(false);
    expect(cli.calls.some(({ kind }) => kind === 'queue-apply')).toBe(false);
    expect(await store.operations()).toEqual([]);
  },
);

test('a save that commits before throwing keeps its snapshot for recovery', async () => {
  const { api, cli, store } = await fixture();
  const preview = await api.preview({ gameId });
  const save = store.saveOperation.bind(store);
  vi.spyOn(store, 'saveOperation').mockImplementationOnce(async (record) => {
    await save(record);
    throw new Error('Fixture uncertain save');
  });
  await expect(api.apply({ previewToken: preview.token })).rejects.toThrow(
    'Fixture uncertain save',
  );
  expect((await store.operations())[0]?.id).toBe(preview.token);
  expect(await store.exists(store.snapshotPath(userId, preview.token))).toBe(true);
  expect(cli.calls.some(({ kind }) => kind === 'queue-apply')).toBe(false);
  const reopened = createWorkspace(cli, store, '0.1.0', '0.3.0', {
    find: async () => ({ state: 'gone' }),
  });
  await reopened.initialize();
  expect((await reopened.history({}))[0]?.state).toBe('unknown');
  expect(await store.exists(store.snapshotPath(userId, preview.token))).toBe(true);
});

test('an unreadable operation record still protects its snapshot', async () => {
  const { store, folder, create, previews } = await fixture();
  const snapshot = await create();
  const operations = join(folder, userId, 'operations');
  await mkdir(operations);
  await writeFile(join(operations, `${snapshot.token}.json`), 'incomplete record');
  await previews.release(snapshot);
  expect(await store.exists(snapshot.path)).toBe(true);
});

test('cancel during the initial operation save cannot remove the consumed snapshot', async () => {
  const { api, store } = await fixture();
  const preview = await api.preview({ gameId });
  const entered = deferred();
  const resume = deferred();
  const save = store.saveOperation.bind(store);
  vi.spyOn(store, 'saveOperation').mockImplementationOnce(async (record) => {
    entered.resolve();
    await resume.promise;
    await save(record);
  });
  const applying = api.apply({ previewToken: preview.token });
  await entered.promise;
  await api.cancelPreview({ previewToken: preview.token });
  expect(await store.exists(store.snapshotPath(userId, preview.token))).toBe(true);
  resume.resolve();
  expect((await applying).state).toBe('complete');
  expect(await store.exists(store.snapshotPath(userId, preview.token))).toBe(true);
});

test.each(['clear', 'shutdown'])(
  'failed cleanup is retried at %s without keeping a usable token',
  async (retry) => {
    const { store, previews, create, save } = await fixture();
    const snapshot = await create();
    save(snapshot);
    vi.spyOn(store, 'removeUnreferencedSnapshot').mockRejectedValueOnce(
      new Error('Fixture locked file'),
    );
    await previews.discard(snapshot.token);
    expect(() => previews.consume(snapshot.token)).toThrow('review your queue again');
    expect(previews.pending).toBe(false);
    expect(await store.exists(snapshot.path)).toBe(true);
    if (retry === 'shutdown') await previews.onModuleDestroy();
    else await previews.clear();
    expect(await store.exists(snapshot.path)).toBe(false);
  },
);

test('a cleanup failure does not replace the preview error and is retried on the next preview', async () => {
  const { api, cli, store } = await fixture();
  let failedPath = '';
  cli.failure = (command) => {
    if (command.kind === 'queue-preview') {
      failedPath = command.file;
      throw new Error('Fixture preview error');
    }
  };
  vi.spyOn(store, 'removeUnreferencedSnapshot').mockRejectedValueOnce(
    new Error('Fixture cleanup error'),
  );
  await expect(api.preview({ gameId })).rejects.toThrow('Fixture preview error');
  expect(await store.exists(failedPath)).toBe(true);
  cli.failure = null;
  const next = await api.preview({ gameId });
  expect(await store.exists(failedPath)).toBe(false);
  expect(await store.exists(store.snapshotPath(userId, next.token))).toBe(true);
});

test('slow cleanup cannot remove a replacement preview and concurrent cancellation is drained', async () => {
  const { store, previews, create, save } = await fixture();
  const first = await create();
  save(first);
  const entered = deferred();
  const resume = deferred();
  const remove = store.removeUnreferencedSnapshot.bind(store);
  vi.spyOn(store, 'removeUnreferencedSnapshot').mockImplementationOnce(async (...args) => {
    entered.resolve();
    await resume.promise;
    await remove(...args);
  });
  const clearing = previews.clear();
  await entered.promise;
  const next = await create();
  save(next);
  resume.resolve();
  await clearing;
  expect(await store.exists(first.path)).toBe(false);
  expect(await store.exists(next.path)).toBe(true);
  const third = await create();
  save(third);
  await Promise.all([previews.discard(next.token), previews.discard(third.token)]);
  expect(await store.exists(next.path)).toBe(false);
  expect(await store.exists(third.path)).toBe(false);
});

test('invalidation during snapshot creation removes the late file without publishing a token', async () => {
  const { store, previews, create } = await fixture();
  const entered = deferred();
  const resume = deferred();
  const snapshot = store.snapshot.bind(store);
  let path = '';
  vi.spyOn(store, 'snapshot').mockImplementationOnce(async (...args) => {
    const result = await snapshot(...args);
    path = result.path;
    entered.resolve();
    await resume.promise;
    return result;
  });
  const creating = create();
  const failed = expect(creating).rejects.toMatchObject({ code: 'STALE_PREVIEW' });
  await entered.promise;
  await previews.clear();
  expect(await store.exists(path)).toBe(true);
  resume.resolve();
  await failed;
  expect(await store.exists(path)).toBe(false);
  expect(previews.pending).toBe(false);
});

test('invalidation waits for the preview producer to release its file', async () => {
  const { store, previews, create, save } = await fixture();
  const snapshot = await create();
  await previews.clear();
  expect(await store.exists(snapshot.path)).toBe(true);
  expect(() => save(snapshot)).toThrow('review your queue again');
  await previews.release(snapshot);
  expect(await store.exists(snapshot.path)).toBe(false);
});

test('shutdown removes ready snapshots but keeps retained operation evidence', async () => {
  const { store, previews, create, save, api } = await fixture();
  const snapshot = await create();
  save(snapshot);
  const preview = await api.preview({ gameId });
  await api.apply({ previewToken: preview.token });
  await previews.onModuleDestroy();
  expect(await store.exists(snapshot.path)).toBe(false);
  expect(await store.exists(store.snapshotPath(userId, preview.token))).toBe(true);
});

test('partial snapshot writes are cleaned up before an owner receives them', async () => {
  const { store, draft } = await fixture();
  const token = randomUUID();
  vi.mocked(open).mockImplementationOnce(async (...args) => {
    const handle = await realFs.open(...args);
    const write = handle.writeFile.bind(handle);
    vi.spyOn(handle, 'writeFile').mockImplementationOnce(async () => {
      await write('partial snapshot');
      throw new Error('Fixture disk full');
    });
    return handle;
  });
  await expect(store.snapshot(userId, token, draft)).rejects.toThrow('Fixture disk full');
  expect(await readdir(dirname(store.snapshotPath(userId, token)))).toEqual([]);
});

test('an exclusive-create collision preserves the existing snapshot', async () => {
  const { store, create, draft } = await fixture();
  const snapshot = await create();
  const bytes = await readFile(snapshot.path);
  await expect(store.snapshot(userId, snapshot.token, draft)).rejects.toMatchObject({
    code: 'EEXIST',
  });
  expect(await readFile(snapshot.path)).toEqual(bytes);
});
