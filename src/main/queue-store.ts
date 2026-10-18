import { randomUUID, createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, readdir, open, unlink, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Dirent } from 'node:fs';
import { z } from 'zod';
import type { OperationRecord, Queue, Report } from '../shared/api';
import { idSchema, tokenSchema, reportSchema, queueSchema } from '../shared/schemas';
import { DesktopError } from './errors';
import { isConfirmedChange, remainingQueueItems } from '../shared/queue-cleanup';
const errorSchema = z.object({ code: z.string(), message: z.string() });
const identitySchema = z.object({ pid: z.number().int().positive(), startedAt: z.string() });
const recordSchema = z.object({
  id: tokenSchema,
  user_id: idSchema,
  game_id: idSchema,
  game_title: z.string(),
  started_at: z.string(),
  finished_at: z.string().nullable(),
  state: z.enum(['running', 'complete', 'unknown']),
  report: reportSchema.nullable(),
  error: errorSchema.optional(),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  process: identitySchema.nullable(),
});
export type StoredOperation = z.infer<typeof recordSchema>;
export const digestBytes = (bytes: Buffer): string =>
  createHash('sha256').update(bytes).digest('hex');
export class QueueStore {
  constructor(readonly root: string) {}
  private accountFolder(userId: string): string {
    return join(this.root, idSchema.parse(userId));
  }
  async draftPath(userId: string, gameId: string): Promise<string> {
    const folder = join(this.accountFolder(userId), 'drafts');
    await mkdir(folder, { recursive: true, mode: 0o700 });
    return join(folder, `${idSchema.parse(gameId)}.json`);
  }
  snapshotPath(userId: string, operationId: string): string {
    return join(this.accountFolder(userId), 'snapshots', `${tokenSchema.parse(operationId)}.json`);
  }
  async snapshot(
    userId: string,
    operationId: string,
    source: string,
  ): Promise<{ path: string; digest: string }> {
    const bytes = await this.bytes(source);
    const path = this.snapshotPath(userId, operationId);
    await mkdir(join(this.accountFolder(userId), 'snapshots'), { recursive: true, mode: 0o700 });
    // Only the handle created here owns cleanup. A wx collision must preserve the existing file.
    const file = await open(path, 'wx', 0o400);
    try {
      await file.writeFile(bytes);
      await file.close();
    } catch (error) {
      await file.close().catch(() => {});
      await unlink(path).catch(() => {});
      throw error;
    }
    return { path, digest: digestBytes(bytes) };
  }
  async removeUnreferencedSnapshot(userId: string, operationId: string): Promise<void> {
    const operation = join(
      this.accountFolder(userId),
      'operations',
      `${tokenSchema.parse(operationId)}.json`,
    );
    try {
      await lstat(operation);
      // Even an unreadable or invalid record may be the only evidence of an apply.
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    try {
      await unlink(this.snapshotPath(userId, operationId));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  async bytes(path: string): Promise<Buffer> {
    const bytes = await readFile(path);
    if (bytes.length > 2_000_000)
      throw new DesktopError('QUEUE_TOO_LARGE', 'The queue file exceeds 2 MB.');
    return bytes;
  }
  async exists(path: string): Promise<boolean> {
    try {
      await this.bytes(path);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
  }
  async drafts(userId: string): Promise<Queue[]> {
    const account = idSchema.parse(userId);
    const folder = join(this.accountFolder(account), 'drafts');
    let files: Dirent[];
    try {
      files = await readdir(folder, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    const queues: Queue[] = [];
    for (const file of files) {
      if (!file.isFile() || !/^[1-9]\d{0,29}\.json$/.test(file.name)) continue;
      try {
        const queue = queueSchema.parse(
          JSON.parse((await this.bytes(join(folder, file.name))).toString('utf8')),
        );
        if (queue.user_id === account && file.name === `${queue.game.id}.json`) queues.push(queue);
      } catch {
        // One unreadable draft must not hide other valid saved queues.
      }
    }
    return queues.sort(
      (left, right) =>
        left.game.title.localeCompare(right.game.title) ||
        left.game.id.localeCompare(right.game.id),
    );
  }
  async clearConfirmedItems(reviewed: Queue, report: Report): Promise<void> {
    if (!report.results.some(isConfirmedChange)) return;
    const destination = await this.draftPath(reviewed.user_id, reviewed.game.id);
    // Use the CLI's lock protocol. Never reclaim another command's lock.
    const lockPath = `${destination}.lock`;
    const lock = await open(lockPath, 'wx', 0o600);
    let temporary: string | undefined;
    try {
      await lock.writeFile(
        `${JSON.stringify({ pid: process.pid, started_at: new Date().toISOString() })}\n`,
      );
      const bytes = await this.bytes(destination);
      const draft = queueSchema.parse(JSON.parse(bytes.toString('utf8')));
      if (
        draft.user_id !== reviewed.user_id ||
        draft.game.id !== reviewed.game.id ||
        draft.game.client_id !== reviewed.game.client_id
      )
        throw new DesktopError(
          'QUEUE_CHANGED',
          'The saved draft no longer matches the reviewed game and account.',
        );
      const items = remainingQueueItems(draft, reviewed, report);
      if (items.length === draft.items.length) return;
      const updated = queueSchema.parse({ ...draft, items, updated_at: new Date().toISOString() });
      temporary = `${destination}.${randomUUID()}.tmp`;
      await writeFile(temporary, `${JSON.stringify(updated, null, 2)}\n`, {
        flag: 'wx',
        mode: 0o600,
        flush: true,
      });
      // Also detect manual edits that do not use the CLI lock.
      if (digestBytes(await this.bytes(destination)) !== digestBytes(bytes))
        throw new DesktopError('QUEUE_CHANGED', 'The saved draft changed during cleanup.');
      await rename(temporary, destination);
    } finally {
      if (temporary) await unlink(temporary).catch(() => {});
      try {
        await lock.close();
      } finally {
        await unlink(lockPath);
      }
    }
  }
  async saveOperation(operation: StoredOperation): Promise<void> {
    const folder = join(this.accountFolder(operation.user_id), 'operations');
    await mkdir(folder, { recursive: true, mode: 0o700 });
    const parsed = recordSchema.parse(operation);
    const destination = join(folder, `${parsed.id}.json`);
    const temporary = join(folder, `.${parsed.id}-${randomUUID()}.tmp`);
    await writeFile(temporary, `${JSON.stringify(parsed)}\n`, {
      flag: 'wx',
      mode: 0o600,
      flush: true,
    });
    await rename(temporary, destination);
  }
  async operations(userId?: string): Promise<StoredOperation[]> {
    let accounts: string[];
    if (userId) accounts = [idSchema.parse(userId)];
    else {
      try {
        accounts = (await readdir(this.root)).filter((value) => idSchema.safeParse(value).success);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
        throw error;
      }
    }
    const records: StoredOperation[] = [];
    for (const account of accounts) {
      const folder = join(this.accountFolder(account), 'operations');
      let files: string[];
      try {
        files = await readdir(folder);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw error;
      }
      for (const file of files.filter((value) => /^[a-f0-9-]{36}\.json$/.test(value))) {
        try {
          const record = recordSchema.parse(JSON.parse(await readFile(join(folder, file), 'utf8')));
          if (record.user_id !== account || file !== `${record.id}.json`) throw new Error();
          records.push(record);
        } catch {
          throw new DesktopError(
            'HISTORY_INVALID',
            'A saved operation could not be read. Review local recovery data before applying.',
          );
        }
      }
    }
    return records.sort((left, right) => right.started_at.localeCompare(left.started_at));
  }
  publicRecord(record: StoredOperation): OperationRecord {
    const { digest: _digest, process: _process, ...publicFields } = record;
    return publicFields;
  }
}
