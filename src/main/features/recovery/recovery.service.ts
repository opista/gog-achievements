import { Inject, Injectable } from '@nestjs/common';
import { QueueStore, type StoredOperation } from '../../queue-store';
import type { ProcessProbe } from '../../process-identity';
import { PROCESS_PROBE } from '../../workspace.tokens';
import { OperationCoordinator } from '../../application/operation-coordinator';
@Injectable()
export class RecoveryService {
  private recoveryLoaded: Promise<void> | null = null;
  private recoveryCheck: Promise<void> | null = null;
  private recovering: StoredOperation[] = [];
  constructor(
    @Inject(QueueStore) private readonly store: QueueStore,
    @Inject(PROCESS_PROBE) private readonly probe: ProcessProbe,
    @Inject(OperationCoordinator) private readonly operations: OperationCoordinator,
  ) {}
  async ensure(): Promise<void> {
    this.recoveryLoaded ??= (async () => {
      this.recovering = (await this.store.operations()).filter(
        (record) => record.state === 'running',
      );
      if (this.recovering.length) await this.recover();
    })().catch((error: unknown) => {
      this.recoveryLoaded = null;
      throw error;
    });
    await this.recoveryLoaded;
  }
  private async recover(): Promise<void> {
    this.recoveryCheck ??= this.inspectRecovery().finally(() => {
      this.recoveryCheck = null;
    });
    await this.recoveryCheck;
  }
  private async inspectRecovery(): Promise<void> {
    let active: StoredOperation | undefined;
    for (const record of this.recovering) {
      const status = await this.probe.find(
        this.store.snapshotPath(record.user_id, record.id),
        record.process,
      );
      if (status.state !== 'gone') {
        active ??= record;
        continue;
      }
      record.state = 'unknown';
      record.finished_at = new Date().toISOString();
      record.error = {
        code: 'INTERRUPTED',
        message:
          'Your previous changes could not be confirmed. Refresh achievements before trying again.',
      };
      await this.store.saveOperation(record);
    }
    this.recovering = this.recovering.filter((record) => record.state === 'running');
    if (active)
      this.operations.publish({
        kind: 'recovery',
        operationId: active.id,
        gameId: active.game_id,
        startedAt: active.started_at,
        message: 'Checking previous changes. Please keep the app open.',
      });
    else this.operations.publish({ kind: 'idle' });
  }
  async refresh(): Promise<void> {
    if (this.operations.current.kind === 'recovery') await this.recover();
  }
}
