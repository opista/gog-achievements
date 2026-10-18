import { z } from 'zod';

export const idSchema = z.string().regex(/^[1-9]\d{0,29}$/);
export const tokenSchema = z.string().uuid();
export const timestampSchema = z
  .string()
  .max(40)
  .refine((value) => {
    const match =
      /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(
        value,
      );
    if (!match) return false;
    const y = match[1]!;
    const m = match[2]!;
    const d = match[3]!;
    const h = match[4]!;
    const minute = match[5]!;
    const second = match[6]!;
    const zone = match[7]!;
    const calendar = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
    const parsed = Date.parse(value);
    return (
      Number(y) >= 1970 &&
      calendar.getUTCFullYear() === Number(y) &&
      calendar.getUTCMonth() === Number(m) - 1 &&
      calendar.getUTCDate() === Number(d) &&
      Number(h) < 24 &&
      Number(minute) < 60 &&
      Number(second) < 60 &&
      (zone === 'Z' || (Number(zone.slice(1, 3)) < 24 && Number(zone.slice(4)) < 60)) &&
      Number.isFinite(parsed) &&
      parsed >= 0 &&
      parsed <= Date.now()
    );
  }, 'Use a valid past RFC 3339 timestamp with an explicit offset.');
const observedDate = z
  .string()
  .max(64)
  .refine((value) => Number.isFinite(Date.parse(value)));
export const authSchema = z
  .object({
    authenticated: z.boolean(),
    user_id: idSchema.optional(),
    expired: z.boolean().optional(),
    storage: z.string().optional(),
    local_login_removed: z.boolean().optional(),
    method: z.string().optional(),
  })
  .refine((value) => !value.authenticated || !!value.user_id);
export const gameSchema = z.object({
  id: idSchema,
  title: z.string(),
  slug: z.string().nullable().optional(),
  image: z.string().nullable().optional(),
  works_on: z.unknown().optional(),
});
export const queueGameSchema = z.object({ id: idSchema, title: z.string(), client_id: idSchema });
export const achievementSchema = z
  .object({
    id: idSchema,
    key: z.string(),
    name: z.string(),
    description: z.string(),
    unlocked: z.boolean(),
    unlocked_at: observedDate.nullable(),
    hidden: z.boolean(),
    image_locked: z.string().nullable(),
    image_unlocked: z.string().nullable(),
    rarity: z.unknown(),
  })
  .refine((value) => value.unlocked === (value.unlocked_at !== null));
export const gamesSchema = z
  .object({ user_id: idSchema, count: z.number().int().nonnegative(), games: z.array(gameSchema) })
  .refine((value) => value.count === value.games.length);
export const achievementsSchema = z
  .object({
    user_id: idSchema,
    game: queueGameSchema,
    count: z.number().int().nonnegative(),
    achievements: z.array(achievementSchema),
  })
  .refine((value) => value.count === value.achievements.length);
const requestIdentity = { achievement_id: idSchema, key: z.string(), name: z.string() };
const queueItemSchema = z.union([
  z
    .object({
      ...requestIdentity,
      action: z.literal('unlock').optional(),
      unlocked_at: timestampSchema,
    })
    .strict(),
  z
    .object({ ...requestIdentity, action: z.literal('lock'), previous_unlocked_at: observedDate })
    .strict(),
]);
export const queueSchema = z
  .object({
    schema_version: z.literal(1),
    user_id: idSchema,
    game: queueGameSchema.strict(),
    created_at: timestampSchema,
    updated_at: timestampSchema,
    items: z.array(queueItemSchema).max(1000),
  })
  .strict()
  .refine(
    (value) => new Set(value.items.map((item) => item.achievement_id)).size === value.items.length,
  );
const reportIdentity = {
  achievement_id: idSchema,
  name: z.string(),
  actual_unlocked_at: observedDate.nullable(),
  error_code: z
    .string()
    .regex(/^[A-Z][A-Z0-9_]{0,63}$/)
    .optional(),
};
const unlockReportItemSchema = z
  .object({
    ...reportIdentity,
    action: z.literal('unlock').optional(),
    requested_unlocked_at: timestampSchema,
    previous_unlocked_at: observedDate.nullable(),
    status: z.enum([
      'pending',
      'restored',
      'skipped_already_unlocked',
      'restored_with_different_date',
      'failed',
      'unconfirmed',
      'not_attempted',
    ]),
  })
  .refine((value) => {
    if (value.status === 'restored')
      return (
        value.actual_unlocked_at !== null &&
        Date.parse(value.actual_unlocked_at) === Date.parse(value.requested_unlocked_at)
      );
    if (value.status === 'restored_with_different_date')
      return (
        value.actual_unlocked_at !== null &&
        Date.parse(value.actual_unlocked_at) !== Date.parse(value.requested_unlocked_at)
      );
    if (value.status === 'skipped_already_unlocked') return value.actual_unlocked_at !== null;
    if (value.status === 'pending') return value.actual_unlocked_at === null;
    return true;
  });
const lockReportItemSchema = z
  .object({
    ...reportIdentity,
    action: z.literal('lock'),
    requested_unlocked_at: z.null(),
    previous_unlocked_at: observedDate,
    status: z.enum([
      'pending',
      'locked',
      'skipped_already_locked',
      'failed',
      'unconfirmed',
      'not_attempted',
    ]),
  })
  .refine((value) => {
    if (value.status === 'locked' || value.status === 'skipped_already_locked')
      return value.actual_unlocked_at === null;
    if (value.status === 'pending')
      return (
        value.actual_unlocked_at !== null &&
        Date.parse(value.actual_unlocked_at) === Date.parse(value.previous_unlocked_at)
      );
    return true;
  });
const reportItemSchema = z.union([unlockReportItemSchema, lockReportItemSchema]);
export const reportSchema = z
  .object({
    dry_run: z.boolean(),
    user_id: idSchema,
    game: queueGameSchema,
    complete: z.boolean(),
    results: z.array(reportItemSchema).max(1000),
  })
  .refine((value) =>
    value.dry_run
      ? value.complete &&
        value.results.every((item) =>
          ['pending', 'skipped_already_unlocked', 'skipped_already_locked'].includes(item.status),
        )
      : !value.results.some((item) => item.status === 'pending') &&
        value.complete ===
          value.results.every((item) =>
            ['restored', 'skipped_already_unlocked', 'locked', 'skipped_already_locked'].includes(
              item.status,
            ),
          ),
  );
export const selectionSchema = z
  .object({ gameId: idSchema, achievementIds: z.array(idSchema).min(1).max(1000) })
  .strict()
  .refine((value) => new Set(value.achievementIds).size === value.achievementIds.length);
export const additionSchema = selectionSchema.safeExtend({
  action: z.enum(['unlock', 'lock']).optional(),
});
export const datesSchema = z
  .object({ gameId: idSchema, dates: z.record(idSchema, timestampSchema) })
  .strict()
  .refine(
    (value) => Object.keys(value.dates).length > 0 && Object.keys(value.dates).length <= 1000,
  );
export const gameInputSchema = z.object({ gameId: idSchema }).strict();
export const exportInputSchema = z
  .object({
    gameId: idSchema,
    search: z.string().max(1000).optional(),
    status: z.enum(['all', 'locked', 'unlocked']).optional(),
  })
  .strict();
export const exportResultSchema = z
  .object({
    path: z.string().min(1),
    count: z.number().int().nonnegative(),
  })
  .strict();
export const historyInputSchema = z.object({ gameId: idSchema.optional() }).strict();
export const applyInputSchema = z.object({ previewToken: tokenSchema }).strict();
export const ipcSchemas = {
  initialize: z.undefined(),
  checkForUpdates: z.undefined(),
  login: z.undefined(),
  logout: z.undefined(),
  listGames: z.undefined(),
  listAchievements: idSchema,
  exportAchievements: exportInputSchema,
  getQueue: idSchema,
  listQueues: z.undefined(),
  addAchievements: additionSchema,
  removeAchievements: selectionSchema,
  setDates: datesSchema,
  preview: gameInputSchema,
  apply: applyInputSchema,
  history: historyInputSchema,
  checkCurrentState: gameInputSchema,
} as const;
