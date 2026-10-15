import { expect, test } from 'vitest';
import type { LockQueueItem, LockReportItem, Queue } from '../../src/shared/api';
import {
  additionSchema,
  queueSchema,
  reportSchema,
  selectionSchema,
} from '../../src/shared/schemas';
import { remainingQueueItems, sameQueueRequest } from '../../src/shared/queue-cleanup';
import { validateReport } from '../../src/main/application/report-validation';
import { makeQueue, makeReport } from '../main/fixtures';

const lock: LockQueueItem = {
  achievement_id: '102',
  key: 'KEY_102',
  name: 'Earned achievement',
  action: 'lock',
  previous_unlocked_at: '2020-02-01T12:34:56.123456+0000',
};
function mixed(): Queue {
  return { ...makeQueue(), items: [...makeQueue().items, { ...lock }] };
}
function locked(status: LockReportItem['status'] = 'locked'): LockReportItem {
  return {
    achievement_id: lock.achievement_id,
    name: lock.name,
    action: 'lock',
    requested_unlocked_at: null,
    previous_unlocked_at: lock.previous_unlocked_at,
    actual_unlocked_at: status === 'pending' ? lock.previous_unlocked_at : null,
    status,
  };
}

test('schema 1 keeps old unlocks and exact observed lock dates, with one action per achievement', () => {
  const queue = mixed();
  expect(queueSchema.parse(queue)).toEqual(queue);
  expect(
    queueSchema.parse({ ...queue, items: [{ ...queue.items[0], action: 'unlock' }, lock] }),
  ).toMatchObject({ items: [{ action: 'unlock' }, lock] });
  for (const item of [
    { ...lock, previous_unlocked_at: null },
    { ...lock, unlocked_at: null },
    { ...lock, unlocked_at: '2020-01-01T00:00:00Z' },
    { ...lock, action: 'reset' },
    { ...queue.items[0], action: 'lock' },
  ])
    expect(queueSchema.safeParse({ ...queue, items: [item] }).success).toBe(false);
  expect(
    queueSchema.safeParse({
      ...queue,
      items: [queue.items[0], { ...lock, achievement_id: queue.items[0]!.achievement_id }],
    }).success,
  ).toBe(false);
  const input = { gameId: queue.game.id, achievementIds: ['101'], action: 'lock' };
  expect(additionSchema.parse(input)).toEqual(input);
  expect(additionSchema.safeParse({ ...input, achievementIds: ['101', '101'] }).success).toBe(
    false,
  );
  expect(additionSchema.safeParse({ ...input, action: 'reset' }).success).toBe(false);
  expect(selectionSchema.safeParse(input).success).toBe(false);
});

test('lock reports need an explicit action and confirmed status, with consistent preview dates', () => {
  const queue = mixed();
  const report = makeReport(queue, false);
  expect(reportSchema.parse(report)).toEqual(report);
  expect(reportSchema.safeParse(makeReport(queue, true)).success).toBe(true);
  for (const row of [
    { ...locked(), action: undefined },
    { ...locked(), status: 'restored' },
    { ...locked(), actual_unlocked_at: lock.previous_unlocked_at },
    { ...locked(), previous_unlocked_at: null },
    { ...locked(), requested_unlocked_at: lock.previous_unlocked_at },
  ])
    expect(reportSchema.safeParse({ ...report, results: [row] }).success).toBe(false);
  expect(reportSchema.safeParse({ ...report, dry_run: true }).success).toBe(false);
  expect(reportSchema.safeParse({ ...report, complete: false }).success).toBe(false);
  const preview = makeReport(queue, true);
  expect(
    reportSchema.safeParse({
      ...preview,
      results: [{ ...locked('pending'), actual_unlocked_at: null }],
    }).success,
  ).toBe(false);
  expect(
    reportSchema.safeParse({
      ...preview,
      results: [{ ...locked('pending'), actual_unlocked_at: '2020-03-01T00:00:00Z' }],
    }).success,
  ).toBe(false);
});

test('report validation binds the action and saved unlock date to the reviewed queue', () => {
  const queue = mixed();
  const report = makeReport(queue, false);
  expect(() => validateReport(report, queue, false)).not.toThrow();
  expect(() =>
    validateReport(
      {
        ...report,
        results: [
          report.results[0]!,
          { ...locked(), previous_unlocked_at: '2020-03-01T00:00:00Z' },
        ],
      },
      queue,
      false,
    ),
  ).toThrow();
  const wrongAction = makeReport(
    {
      ...queue,
      items: [
        queue.items[0]!,
        {
          achievement_id: lock.achievement_id,
          key: lock.key,
          name: lock.name,
          unlocked_at: lock.previous_unlocked_at,
        },
      ],
    },
    false,
  );
  expect(() => validateReport(wrongAction, queue, false)).toThrow();
});

test('cleanup removes confirmed mixed actions only, retaining uncertain locks and changed requests', () => {
  const queue = mixed();
  const report = makeReport(queue, false);
  expect(remainingQueueItems(queue, queue, report)).toEqual([]);
  for (const status of ['unconfirmed', 'failed', 'not_attempted'] as const)
    expect(
      remainingQueueItems(queue, queue, {
        ...report,
        complete: false,
        results: [report.results[0]!, locked(status)],
      }),
    ).toEqual([lock]);
  expect(remainingQueueItems(queue, queue, { ...report, dry_run: true })).toEqual(queue.items);
  const updatedLock = { ...lock, previous_unlocked_at: '2020-03-01T00:00:00Z' };
  expect(sameQueueRequest(lock, updatedLock)).toBe(false);
  expect(remainingQueueItems({ ...queue, items: [updatedLock] }, queue, report)).toEqual([
    updatedLock,
  ]);
  const unlock = {
    achievement_id: lock.achievement_id,
    key: lock.key,
    name: lock.name,
    unlocked_at: lock.previous_unlocked_at,
  };
  expect(sameQueueRequest(unlock, lock)).toBe(false);
  expect(remainingQueueItems({ ...queue, items: [unlock] }, queue, report)).toEqual([unlock]);
  const opposite = makeReport({ ...queue, items: [queue.items[0]!, unlock] }, false);
  expect(remainingQueueItems(queue, queue, opposite)).toEqual([lock]);
});
