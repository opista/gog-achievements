import { readFile, writeFile } from 'node:fs/promises';
import type { CliCommand, CliOutcome, CliRunner } from '../../src/main/cli-client';
import type { Queue, Report, Achievement } from '../../src/shared/api';
export const userId = '22446688';
export const gameId = '1423049311';
export const game = { id: gameId, title: 'Cyberpunk 2077', client_id: '18446744073709551615' };
export const achievement = (id = '101'): Achievement => ({
  id,
  key: `KEY_${id}`,
  name: `Achievement ${id}`,
  description: 'Fixture only',
  unlocked: false,
  unlocked_at: null,
  hidden: false,
  image_locked: null,
  image_unlocked: null,
  rarity: null,
});
export const makeQueue = (): Queue => ({
  schema_version: 1,
  user_id: userId,
  game,
  created_at: '2020-01-01T00:00:00Z',
  updated_at: '2020-01-01T00:00:00Z',
  items: [achievement()].map((item) => ({
    achievement_id: item.id,
    key: item.key,
    name: item.name,
    unlocked_at: '2020-01-01T00:00:00Z',
  })),
});
export const makeReport = (queue: Queue, dryRun: boolean): Report => ({
  dry_run: dryRun,
  user_id: queue.user_id,
  game: queue.game,
  complete: true,
  results: queue.items.map((item) => ({
    achievement_id: item.achievement_id,
    name: item.name,
    ...(item.action === 'lock'
      ? {
          action: 'lock' as const,
          requested_unlocked_at: null,
          previous_unlocked_at: item.previous_unlocked_at,
          actual_unlocked_at: dryRun ? item.previous_unlocked_at : null,
          status: dryRun ? ('pending' as const) : ('locked' as const),
        }
      : {
          ...(item.action ? { action: item.action } : {}),
          requested_unlocked_at: item.unlocked_at,
          previous_unlocked_at: null,
          actual_unlocked_at: dryRun ? null : item.unlocked_at,
          status: dryRun ? ('pending' as const) : ('restored' as const),
        }),
  })),
});
const ok = (data: unknown): CliOutcome => ({ exitCode: 0, result: { ok: true, data } });
export class FakeCli implements CliRunner {
  version = '0.3.0';
  calls: CliCommand[] = [];
  account = userId;
  achievements: Achievement[] = [achievement(), achievement('102'), achievement('103')];
  mode: 'complete' | 'partial' | 'transport' | 'wrong-account' | 'invalid-report' = 'complete';
  pause: Promise<void> | null = null;
  failure: ((command: CliCommand) => void) | null = null;
  supportsLocking = true;
  supportsExporting = false;
  async run(command: CliCommand, onSpawn?: (pid: number) => Promise<void>): Promise<CliOutcome> {
    this.calls.push(command);
    this.failure?.(command);
    if (command.kind === 'help')
      return ok({
        version: this.version,
        commands: [
          ...['queue create', 'queue add'].map((command) => ({
            command,
            flags: this.supportsLocking ? ['action'] : [],
          })),
          ...(this.supportsExporting
            ? [{ command: 'achievements export', flags: ['game', 'file', 'search', 'status'] }]
            : []),
        ],
      });
    if (command.kind === 'doctor') return ok({ supported: true, credentials_available: true });
    if (command.kind === 'auth-status' || command.kind === 'auth-login')
      return ok({ authenticated: true, user_id: this.account, expired: false, storage: 'fixture' });
    if (command.kind === 'auth-logout')
      return ok({ authenticated: false, local_login_removed: true });
    if (command.kind === 'games')
      return ok({ user_id: this.account, count: 1, games: [{ id: gameId, title: game.title }] });
    if (command.kind === 'achievements')
      return ok({
        user_id: this.account,
        game,
        count: this.achievements.length,
        achievements: this.achievements,
      });
    if (!('file' in command)) throw new Error('Unsupported fixture command');
    if (command.kind === 'achievements-export') return ok({ path: command.file, count: 2 });
    let queue: Queue;
    if (command.kind === 'queue-create') {
      queue = {
        ...makeQueue(),
        user_id: this.account,
        items: command.achievementIds.map((id) => {
          const item = achievement(id);
          return {
            achievement_id: id,
            key: item.key,
            name: item.name,
            ...(command.action === 'lock'
              ? {
                  action: 'lock' as const,
                  previous_unlocked_at: this.achievements.find((entry) => entry.id === id)!
                    .unlocked_at!,
                }
              : { unlocked_at: '2020-01-01T00:00:00Z' }),
          };
        }),
      };
      await writeFile(command.file, JSON.stringify(queue));
      return ok(queue);
    }
    queue = JSON.parse(await readFile(command.file, 'utf8')) as Queue;
    if (command.kind === 'queue-show') return ok(queue);
    if (command.kind === 'queue-preview') return ok(makeReport(queue, true));
    if (command.kind === 'queue-apply') {
      await onSpawn?.(12345);
      if (this.pause) await this.pause;
      if (this.mode === 'transport') throw new Error('https://auth.gog.com/?code=fixture-secret');
      const report = makeReport(queue, false);
      if (this.mode === 'wrong-account') report.user_id = '999';
      if (this.mode === 'invalid-report') report.results[0]!.achievement_id = '999';
      if (this.mode === 'partial') {
        report.complete = false;
        report.results[0]!.status = 'unconfirmed';
        report.results[0]!.actual_unlocked_at = null;
        return {
          exitCode: 6,
          result: {
            ok: false,
            error: {
              code: 'APPLY_INCOMPLETE',
              message: 'Ignored fixture message',
              details: { report },
            },
          },
        };
      }
      return ok(report);
    }
    if (command.kind === 'queue-remove')
      queue.items = queue.items.filter(
        (item) => !command.achievementIds.includes(item.achievement_id),
      );
    if (command.kind === 'queue-add')
      for (const id of command.achievementIds) {
        const item = achievement(id);
        queue.items.push({
          achievement_id: id,
          key: item.key,
          name: item.name,
          ...(command.action === 'lock'
            ? {
                action: 'lock' as const,
                previous_unlocked_at: this.achievements.find((entry) => entry.id === id)!
                  .unlocked_at!,
              }
            : { unlocked_at: '2020-01-01T00:00:00Z' }),
        });
      }
    if (command.kind === 'queue-date')
      for (const item of queue.items)
        if (item.action !== 'lock' && command.achievementIds.includes(item.achievement_id))
          item.unlocked_at = command.timestamp;
    await writeFile(command.file, JSON.stringify(queue));
    return ok(queue);
  }
}
