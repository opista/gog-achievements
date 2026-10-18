import { afterEach, expect, test, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { QueueStore } from '../../../src/main/queue-store';
import { randomUUID } from 'node:crypto';
import { SessionService } from '../../../src/main/features/account/session.service';
import { PreviewStore } from '../../../src/main/application/preview-store';
import { FakeCli, makeQueue, makeReport, userId } from '../fixtures';

const folders: string[] = [];
afterEach(async () => {
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
});

async function fixture() {
  const folder = await mkdtemp(join(tmpdir(), 'gog-preview-session-'));
  folders.push(folder);
  const store = new QueueStore(folder);
  const cli = new FakeCli();
  const previews = new PreviewStore(store);
  const session = new SessionService(cli, previews, { app: '0.1.0', cli: '0.3.0' });
  async function savePreview() {
    const token = randomUUID();
    const queue = makeQueue();
    const draft = await store.draftPath(queue.user_id, queue.game.id);
    await writeFile(draft, JSON.stringify(queue));
    const snapshot = await previews.create(queue.user_id, token, draft);
    previews.save({
      ...snapshot,
      queue,
      report: makeReport(queue, true),
    });
    return token;
  }
  return { cli, previews, session, savePreview };
}

test('fresh initialization retains a matching preview and invalidates it when the account changes', async () => {
  const { cli, previews, session, savePreview } = await fixture();
  await session.initialize();
  const matching = await savePreview();
  expect((await session.initialize()).auth.user_id).toBe(userId);
  expect(previews.consume(matching).queue.user_id).toBe(userId);
  const previous = await savePreview();
  cli.account = '998877';
  expect((await session.initialize()).auth.user_id).toBe('998877');
  expect(() => previews.consume(previous)).toThrow('review your queue again');
  expect(cli.calls.some(({ kind }) => kind === 'queue-apply')).toBe(false);
});

test('a missing saved session invalidates previews before rejecting the account check', async () => {
  const { cli, previews, session, savePreview } = await fixture();
  await session.initialize();
  const token = await savePreview();
  vi.spyOn(cli, 'run').mockResolvedValueOnce({
    exitCode: 0,
    result: { ok: true, data: { authenticated: false } },
  });
  await expect(session.requireAccount()).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
  expect(() => previews.consume(token)).toThrow('review your queue again');
});

test.each(['login', 'logout'] as const)(
  '%s invalidates review tokens even when the CLI call fails',
  async (method) => {
    const { cli, previews, session, savePreview } = await fixture();
    await session.initialize();
    const token = await savePreview();
    vi.spyOn(cli, 'run').mockRejectedValueOnce(new Error('Authentication failed.'));
    await expect(session[method]()).rejects.toThrow('Authentication failed.');
    expect(() => previews.consume(token)).toThrow('review your queue again');
  },
);
