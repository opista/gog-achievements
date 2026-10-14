import { randomUUID, createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { OperationRecord } from '../shared/api';
import { idSchema, tokenSchema, reportSchema } from '../shared/schemas';
import type { ProcessIdentity } from './process-identity';
import { DesktopError } from './errors';
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
export interface StoredOperation extends OperationRecord {
  digest: string;
  process: ProcessIdentity | null;
}
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
    await writeFile(path, bytes, { flag: 'wx', mode: 0o400 });
    return { path, digest: digestBytes(bytes) };
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
          records.push(record as StoredOperation);
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
