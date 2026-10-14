import { afterEach, expect, test } from 'vitest';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { QueueStore } from '../../src/main/queue-store';
import { remainingQueueItems } from '../../src/shared/queue-cleanup';
import { gameId, userId, makeQueue, makeReport } from './fixtures';

const folders: string[] = [];
afterEach(async () => {
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
});
async function fixture() {
  const folder = await mkdtemp(join(tmpdir(), 'gog-queue-cleanup-'));
  folders.push(folder);
  const store = new QueueStore(folder);
  const file = await store.draftPath(userId, gameId);
  const queue = makeQueue();
  await writeFile(file, JSON.stringify(queue));
  return { store, file, queue, report: makeReport(queue, false) };
}

test('cleanup owns a CLI-compatible lock through atomic replacement and removes its temporary files', async () => {
  const { store, file, queue, report } = await fixture();
  const original = store.bytes.bind(store);
  const locks: unknown[] = [];
  store.bytes = async (path) => {
    locks.push(JSON.parse(await readFile(`${file}.lock`, 'utf8')));
    return original(path);
  };
  await store.clearConfirmedItems(queue, report);
  expect(locks).toHaveLength(2);
  expect(locks[0]).toMatchObject({ pid: process.pid, started_at: expect.any(String) });
  expect(JSON.parse(await readFile(file, 'utf8')).items).toEqual([]);
  expect(await readdir(dirname(file))).toEqual([`${gameId}.json`]);
});

test.each(['user_id', 'game_id', 'client_id'] as const)(
  'cleanup rejects a changed %s without replacing its draft',
  async (field) => {
    const { store, file, queue, report } = await fixture();
    const draft = structuredClone(queue);
    if (field === 'user_id') draft.user_id = '998877';
    else if (field === 'game_id') draft.game.id = '998877';
    else draft.game.client_id = '998877';
    const edited = JSON.stringify(draft);
    await writeFile(file, edited);
    await expect(store.clearConfirmedItems(queue, report)).rejects.toThrow('no longer matches');
    expect(await readFile(file, 'utf8')).toBe(edited);
    expect(await readdir(dirname(file))).toEqual([`${gameId}.json`]);
  },
);

test('cleanup detects a manual edit before replacement and preserves it', async () => {
  const { store, file, queue, report } = await fixture();
  const draft = structuredClone(queue);
  draft.items[0]!.unlocked_at = '2020-02-01T00:00:00Z';
  const edited = JSON.stringify(draft);
  const original = store.bytes.bind(store);
  let reads = 0;
  store.bytes = async (path) => {
    if (++reads === 2) await writeFile(file, edited);
    return original(path);
  };
  await expect(store.clearConfirmedItems(queue, report)).rejects.toThrow('changed during cleanup');
  expect(await readFile(file, 'utf8')).toBe(edited);
  expect(await readdir(dirname(file))).toEqual([`${gameId}.json`]);
});

test('reconciliation preserves changed keys and requests but accepts equivalent timestamp offsets', () => {
  const reviewed = makeQueue();
  const report = makeReport(reviewed, false);
  const changed = structuredClone(reviewed);
  changed.items[0]!.key = 'OTHER_KEY';
  expect(remainingQueueItems(changed, reviewed, report)).toEqual(changed.items);
  changed.items[0]!.key = reviewed.items[0]!.key;
  changed.items[0]!.unlocked_at = '2020-01-01T01:00:00+01:00';
  expect(remainingQueueItems(changed, reviewed, report)).toEqual([]);
  report.results[0]!.requested_unlocked_at = '2020-02-01T00:00:00Z';
  expect(remainingQueueItems(changed, reviewed, report)).toEqual(changed.items);
  expect(reviewed.items).toHaveLength(1);
});

test('a dry-run or report for another account cannot remove draft rows', () => {
  const reviewed = makeQueue();
  const preview = makeReport(reviewed, true);
  preview.results[0]!.status = 'skipped_already_unlocked';
  preview.results[0]!.actual_unlocked_at = '2020-01-01T00:00:00Z';
  expect(remainingQueueItems(reviewed, reviewed, preview)).toEqual(reviewed.items);
  const report = makeReport(reviewed, false);
  report.user_id = '998877';
  expect(remainingQueueItems(reviewed, reviewed, report)).toEqual(reviewed.items);
});

test('draft discovery validates filenames, queue metadata and account ownership without changing files', async () => {
  const { store, file, queue } = await fixture();
  const folder = dirname(file);
  await writeFile(join(folder, '101.json'), 'invalid JSON');
  await writeFile(
    join(folder, '102.json'),
    JSON.stringify({ ...queue, user_id: '998877', game: { ...queue.game, id: '102' } }),
  );
  await writeFile(join(folder, '103.json'), JSON.stringify(queue));
  await writeFile(join(folder, '104.json.tmp'), JSON.stringify(queue));
  await writeFile(`${file}.lock`, '{"pid":98765}');
  const foreignFile = await store.draftPath('998877', gameId);
  await writeFile(foreignFile, JSON.stringify({ ...queue, user_id: '998877' }));
  expect(await store.drafts(userId)).toEqual([queue]);
  expect((await store.drafts('998877'))[0]?.user_id).toBe('998877');
  expect(await readFile(join(folder, '101.json'), 'utf8')).toBe('invalid JSON');
  expect(await readFile(`${file}.lock`, 'utf8')).toBe('{"pid":98765}');
  expect(await store.drafts('554433')).toEqual([]);
});
