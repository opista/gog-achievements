import { expect, test, vi } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SessionService } from '../../../src/main/features/account/session.service';
import { LibraryService } from '../../../src/main/features/library/library.service';
import { PreviewStore } from '../../../src/main/application/preview-store';
import { FakeCli, gameId } from '../fixtures';

function fixture(supported = true) {
  const cli = new FakeCli();
  cli.supportsExporting = supported;
  const previews = new PreviewStore();
  const session = new SessionService(cli, previews, { app: '0.1.0', cli: '0.3.0' });
  const file = join(tmpdir(), 'selected achievements.csv');
  const choose = vi.fn<() => Promise<string | null>>().mockResolvedValue(file);
  const library = new LibraryService(cli, session, previews, choose);
  return { cli, session, library, choose, file };
}

test('export uses the selected native path and passes filters to the CLI without queue operations', async () => {
  const { cli, session, library, choose, file } = fixture();
  expect((await session.initialize()).supportsExporting).toBe(true);
  expect(await library.exportAchievements({ gameId, search: 'HOME', status: 'locked' })).toEqual({
    cancelled: false,
    path: file,
    count: 2,
  });
  expect(choose).toHaveBeenCalledExactlyOnceWith(gameId);
  expect(cli.calls.at(-1)).toEqual({
    kind: 'achievements-export',
    gameId,
    file,
    search: 'HOME',
    status: 'locked',
  });
  expect(cli.calls.some(({ kind }) => kind.startsWith('queue-'))).toBe(false);
});

test('cancelled export does not invoke the export command', async () => {
  const { cli, library, choose } = fixture();
  choose.mockResolvedValue(null);
  expect(await library.exportAchievements({ gameId })).toEqual({ cancelled: true });
  expect(cli.calls.some(({ kind }) => kind === 'achievements-export')).toBe(false);
});

test('the pinned CLI without export support cannot open the save dialog', async () => {
  const { cli, session, library, choose } = fixture(false);
  expect((await session.initialize()).supportsExporting).toBe(false);
  await expect(library.exportAchievements({ gameId })).rejects.toMatchObject({
    code: 'CSV_EXPORT_UNSUPPORTED',
  });
  expect(choose).not.toHaveBeenCalled();
  expect(cli.calls.some(({ kind }) => kind === 'achievements-export')).toBe(false);
});

test('export validates input before external calls and keeps destination paths in the main process', async () => {
  const { cli, library, choose } = fixture();
  await expect(
    library.exportAchievements({ gameId, ...{ file: '/untrusted.csv' } }),
  ).rejects.toThrow();
  expect(cli.calls).toEqual([]);
  choose.mockResolvedValue('relative.csv');
  await expect(library.exportAchievements({ gameId })).rejects.toMatchObject({
    code: 'INVALID_EXPORT_PATH',
  });
  expect(cli.calls.some(({ kind }) => kind === 'achievements-export')).toBe(false);
});

test('export preserves CLI errors and rejects an unconfirmed destination', async () => {
  const { cli, library } = fixture();
  await library.exportAchievements({ gameId });
  vi.spyOn(cli, 'run')
    .mockResolvedValueOnce({
      exitCode: 0,
      result: { ok: true, data: { authenticated: true, user_id: cli.account } },
    })
    .mockResolvedValueOnce({
      exitCode: 2,
      result: { ok: false, error: { code: 'EXPORT_EXISTS', message: 'Untrusted message' } },
    });
  await expect(library.exportAchievements({ gameId })).rejects.toMatchObject({
    code: 'EXPORT_EXISTS',
    message: expect.stringContaining('Choose another'),
  });
  vi.mocked(cli.run)
    .mockResolvedValueOnce({
      exitCode: 0,
      result: { ok: true, data: { authenticated: true, user_id: cli.account } },
    })
    .mockResolvedValueOnce({
      exitCode: 0,
      result: { ok: true, data: { path: '/other.csv', count: 1 } },
    });
  await expect(library.exportAchievements({ gameId })).rejects.toMatchObject({
    code: 'INVALID_CLI_OUTPUT',
  });
});
