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
  const second = createDemoApi({ delayMs: 0, storage });
  expect((await second.initialize()).auth.authenticated).toBe(false);
  await second.login();
  expect((await second.history({ gameId: '1' }))[0]?.id).toBe(applied.operationId);
  const achievements = await second.listAchievements('1');
  expect(achievements.achievements[0]?.unlocked_at).toBe('2026-10-10T17:30:00Z');
  expect(achievements.achievements[0]?.unlocked).toBe(true);
});
