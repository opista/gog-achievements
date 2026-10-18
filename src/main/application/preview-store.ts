import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import type { Queue, Report } from '../../shared/api';
import { DesktopError } from '../errors';
import { QueueStore } from '../queue-store';

export interface PreviewSnapshot {
  token: string;
  userId: string;
  path: string;
  draft: string;
  digest: string;
}
export interface Preview extends PreviewSnapshot {
  queue: Queue;
  report: Report;
}
interface OwnedSnapshot {
  snapshot: PreviewSnapshot;
  generation: number;
  state: 'preparing' | 'ready' | 'consumed';
  valid: boolean;
  preview?: Preview;
}
const stalePreview = (): DesktopError =>
  new DesktopError('STALE_PREVIEW', 'Select Apply changes to review your queue again.');

@Injectable()
export class PreviewStore implements OnModuleDestroy {
  private snapshots = new Map<string, OwnedSnapshot>();
  private cleanupPending = new Map<string, PreviewSnapshot>();
  private cleaning: Promise<void> | undefined;
  private generation = 0;
  constructor(@Inject(QueueStore) private readonly store: QueueStore) {}

  async create(userId: string, token: string, draft: string): Promise<PreviewSnapshot> {
    const generation = this.generation;
    const snapshot = { ...(await this.store.snapshot(userId, token, draft)), userId, token, draft };
    this.snapshots.set(token, { snapshot, generation, state: 'preparing', valid: true });
    if (generation !== this.generation) {
      await this.release(snapshot);
      throw stalePreview();
    }
    return snapshot;
  }
  clear(): Promise<void> {
    this.generation++;
    for (const entry of this.snapshots.values()) {
      if (entry.state === 'consumed') continue;
      entry.valid = false;
      // The producer still owns a snapshot while the preview command reads it.
      if (entry.state === 'ready') this.queueCleanup(entry.snapshot);
    }
    return this.cleanup();
  }
  get pending(): boolean {
    return this.snapshots.size > 0;
  }
  discard(token: string): Promise<void> {
    const entry = this.snapshots.get(token);
    if (entry && entry.state !== 'consumed') {
      entry.valid = false;
      if (entry.state === 'ready') this.queueCleanup(entry.snapshot);
    }
    return this.cleanup();
  }
  save(preview: Preview): void {
    const entry = this.snapshots.get(preview.token);
    if (
      !entry ||
      entry.state !== 'preparing' ||
      !entry.valid ||
      entry.generation !== this.generation
    )
      throw stalePreview();
    entry.state = 'ready';
    entry.preview = preview;
  }
  consume(token: string): Preview {
    const entry = this.snapshots.get(token);
    if (!entry || entry.state !== 'ready' || !entry.valid || !entry.preview) throw stalePreview();
    entry.state = 'consumed';
    return entry.preview;
  }
  // A durable operation now owns this snapshot for reports and recovery.
  retain(snapshot: PreviewSnapshot): void {
    this.snapshots.delete(snapshot.token);
  }
  release(snapshot: PreviewSnapshot): Promise<void> {
    this.queueCleanup(snapshot);
    return this.cleanup();
  }
  private queueCleanup(snapshot: PreviewSnapshot): void {
    this.snapshots.delete(snapshot.token);
    this.cleanupPending.set(snapshot.token, snapshot);
  }
  private cleanup(): Promise<void> {
    // Each caller queues a pass, including callers that invalidate another preview while a pass waits.
    const cleaning = (this.cleaning ?? Promise.resolve()).then(async () => {
      await Promise.all(
        [...this.cleanupPending.values()].map(async (snapshot) => {
          try {
            // An uncertain save may have committed before throwing. Keep its evidence.
            await this.store.removeUnreferencedSnapshot(snapshot.userId, snapshot.token);
            this.cleanupPending.delete(snapshot.token);
          } catch {
            // Retry on later invalidation or shutdown without replacing the original error.
          }
        }),
      );
    });
    this.cleaning = cleaning;
    return cleaning.finally(() => {
      if (this.cleaning === cleaning) this.cleaning = undefined;
    });
  }
  async settleCleanup(): Promise<void> {
    await this.cleaning;
  }
  async onModuleDestroy(): Promise<void> {
    await this.clear();
  }
}
