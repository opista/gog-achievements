import { expect, test, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { SessionService } from '../../../src/main/features/account/session.service';
import { PreviewStore } from '../../../src/main/application/preview-store';
import { FakeCli, makeQueue, makeReport, userId } from '../fixtures';

function fixture() {
  const cli = new FakeCli();
  const previews = new PreviewStore();
  const session = new SessionService(cli, previews, { app: '0.1.0', cli: '0.3.0' });
  function savePreview() {
    const token = randomUUID();
    const queue = makeQueue();
    previews.save({
      token,
      queue,
      report: makeReport(queue, true),
      path: '/fixture/reviewed',
      draft: '/fixture/draft',
      digest: '0'.repeat(64),
    });
    return token;
  }
  return { cli, previews, session, savePreview };
}

test('fresh initialization retains a matching preview and invalidates it when the account changes', async () => {
  const { cli, previews, session, savePreview } = fixture();
  await session.initialize();
  const matching = savePreview();
  expect((await session.initialize()).auth.user_id).toBe(userId);
  expect(previews.consume(matching).queue.user_id).toBe(userId);
  const previous = savePreview();
  cli.account = '998877';
  expect((await session.initialize()).auth.user_id).toBe('998877');
  expect(() => previews.consume(previous)).toThrow('review your queue again');
  expect(cli.calls.some(({ kind }) => kind === 'queue-apply')).toBe(false);
});

test('a missing saved session invalidates previews before rejecting the account check', async () => {
  const { cli, previews, session, savePreview } = fixture();
  await session.initialize();
  const token = savePreview();
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
    const { cli, previews, session, savePreview } = fixture();
    await session.initialize();
    const token = savePreview();
    vi.spyOn(cli, 'run').mockRejectedValueOnce(new Error('Authentication failed.'));
    await expect(session[method]()).rejects.toThrow('Authentication failed.');
    expect(() => previews.consume(token)).toThrow('review your queue again');
  },
);
