import { expect, it } from 'vitest';
import { createDemoApi } from '../../src/shared/demo-api';
it('preserves demo reports and confirmed dates across a new signed-out session', async () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
  const first = createDemoApi({ delayMs: 0, storage });
  await first.login();
  const preview = await first.preview({ gameId: '1' });
  expect(preview.token).toMatch(/^[0-9a-f-]{36}$/);
  const applied = await first.apply({ previewToken: preview.token });
  await expect(first.apply({ previewToken: preview.token })).rejects.toThrow('Preview again');
  expect((await first.getQueue('1'))?.items).toEqual([]);
  const second = createDemoApi({ delayMs: 0, storage });
  expect((await second.initialize()).auth.authenticated).toBe(false);
  await second.login();
  expect((await second.history({ gameId: '1' }))[0]?.id).toBe(applied.operationId);
  expect((await second.getQueue('1'))?.items).toEqual([]);
  const achievements = await second.listAchievements('1');
  expect(achievements.achievements[0]?.unlocked_at).toBe('2026-10-10T17:30:00Z');
  expect(achievements.achievements[0]?.unlocked).toBe(true);
});

it('demo partial results retain unconfirmed and unattempted rows but clear confirmed date mismatches', async () => {
  const api = createDemoApi({ delayMs: 0, scenario: 'partial' });
  await api.login();
  const preview = await api.preview({ gameId: '1' });
  const result = await api.apply({ previewToken: preview.token });
  expect(result.report?.results[0]?.status).toBe('restored_with_different_date');
  expect((await api.getQueue('1'))?.items.map((row) => row.achievement_id)).toEqual(['2', '3']);
  expect((await api.history({ gameId: '1' }))[0]?.report?.results).toHaveLength(3);
});

it('demo unknown outcomes keep the full queue for manual review', async () => {
  const api = createDemoApi({ delayMs: 0, scenario: 'unknown' });
  await api.login();
  const before = await api.getQueue('1');
  const preview = await api.preview({ gameId: '1' });
  const result = await api.apply({ previewToken: preview.token });
  expect(result.state).toBe('unknown');
  expect(await api.getQueue('1')).toEqual(before);
});
