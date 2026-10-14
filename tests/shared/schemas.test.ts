import { expect, test } from 'vitest';
import {
  idSchema,
  timestampSchema,
  selectionSchema,
  ipcSchemas,
  queueSchema,
} from '../../src/shared/schemas';
import { makeQueue } from '../main/fixtures';
test('IDs stay exact strings and IPC rejects paths, extra flags and empty selections', () => {
  expect(idSchema.parse('18446744073709551615')).toBe('18446744073709551615');
  for (const bad of [123, '0', '../42', '42;rm', ''])
    expect(idSchema.safeParse(bad).success).toBe(false);
  expect(
    selectionSchema.safeParse({ gameId: '12', achievementIds: ['13'], file: '/arbitrary' }).success,
  ).toBe(false);
  expect(selectionSchema.safeParse({ gameId: '12', achievementIds: [] }).success).toBe(false);
  expect(selectionSchema.safeParse({ gameId: '12', achievementIds: ['13', '13'] }).success).toBe(
    false,
  );
  expect(ipcSchemas.apply.safeParse({ previewToken: 'not-a-token', yes: true }).success).toBe(
    false,
  );
});
test('date inputs require exact offsets, valid calendar dates and past instants', () => {
  for (const date of [
    '2020-02-29T12:34:56+01:00',
    '2020-11-01T01:30:00-04:00',
    '2020-11-01T01:30:00-05:00',
    '2020-01-01T00:00:00Z',
  ])
    expect(timestampSchema.safeParse(date).success).toBe(true);
  for (const date of [
    '2020-02-30T12:34:56Z',
    '2021-02-29T12:34:56Z',
    '2020-01-01T24:00:00Z',
    '2020-01-01T00:00:60Z',
    '2020-01-01T00:00:00+25:00',
    '2020-01-01T00:00:00',
    '2999-01-01T00:00:00Z',
    null,
  ])
    expect(timestampSchema.safeParse(date).success).toBe(false);
});
test('queue validation rejects unknown fields, duplicate IDs and null dates', () => {
  const queue = makeQueue();
  expect(queueSchema.parse(queue)).toEqual(queue);
  expect(queueSchema.safeParse({ ...queue, token: 'must-not-be-here' }).success).toBe(false);
  expect(queueSchema.safeParse({ ...queue, items: [...queue.items, queue.items[0]] }).success).toBe(
    false,
  );
  expect(
    queueSchema.safeParse({ ...queue, items: [{ ...queue.items[0], unlocked_at: null }] }).success,
  ).toBe(false);
});

test('report statuses require truthful observed dates and consistent completion', async () => {
  const { reportSchema } = await import('../../src/shared/schemas');
  const { makeReport } = await import('../main/fixtures');
  const valid = makeReport(makeQueue(), false);
  expect(reportSchema.safeParse(valid).success).toBe(true);
  for (const actual of [null, '2020-02-01T00:00:00Z'])
    expect(
      reportSchema.safeParse({
        ...valid,
        results: [{ ...valid.results[0], actual_unlocked_at: actual }],
      }).success,
    ).toBe(false);
  expect(reportSchema.safeParse({ ...valid, complete: false }).success).toBe(false);
  expect(
    reportSchema.safeParse({
      ...valid,
      complete: false,
      results: [{ ...valid.results[0], status: 'restored_with_different_date' }],
    }).success,
  ).toBe(false);
  expect(
    reportSchema.safeParse({
      ...valid,
      complete: false,
      results: [
        {
          ...valid.results[0],
          status: 'restored_with_different_date',
          actual_unlocked_at: '2020-02-01T00:00:00Z',
        },
      ],
    }).success,
  ).toBe(true);
  expect(
    reportSchema.safeParse({
      ...valid,
      results: [
        { ...valid.results[0], status: 'skipped_already_unlocked', previous_unlocked_at: null },
      ],
    }).success,
  ).toBe(true);
  expect(
    reportSchema.safeParse({
      ...valid,
      results: [
        { ...valid.results[0], status: 'skipped_already_unlocked', actual_unlocked_at: null },
      ],
    }).success,
  ).toBe(false);
  expect(
    reportSchema.safeParse({ ...valid, results: [{ ...valid.results[0], status: 'pending' }] })
      .success,
  ).toBe(false);
});
