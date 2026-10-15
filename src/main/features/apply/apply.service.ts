import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { ApplyResult, PreviewResult, Report } from '../../../shared/api';
import { idSchema, tokenSchema, reportSchema } from '../../../shared/schemas';
import { requireSuccess, type CliRunner } from '../../cli-client';
import { QueueStore, digestBytes, type StoredOperation } from '../../queue-store';
import { DesktopError, publicError, cliError } from '../../errors';
import type { ProcessProbe } from '../../process-identity';
import { CLI_RUNNER, PROCESS_PROBE } from '../../workspace.tokens';
import { OperationCoordinator } from '../../application/operation-coordinator';
import { SessionService } from '../account/session.service';
import { QueueService } from '../queue/queue.service';
import { PreviewStore } from '../../application/preview-store';
import { validateReport } from '../../application/report-validation';
@Injectable()
export class ApplyService {
  constructor(
    @Inject(CLI_RUNNER) private readonly cli: CliRunner,
    @Inject(QueueStore) private readonly store: QueueStore,
    @Inject(PROCESS_PROBE) private readonly probe: ProcessProbe,
    @Inject(OperationCoordinator) private readonly operations: OperationCoordinator,
    @Inject(SessionService) private readonly session: SessionService,
    @Inject(QueueService) private readonly queues: QueueService,
    @Inject(PreviewStore) private readonly previews: PreviewStore,
  ) {}
  async preview({ gameId }: { gameId: string }): Promise<PreviewResult> {
    gameId = idSchema.parse(gameId);
    this.previews.clear();
    const account = await this.session.requireAccount();
    const queue = await this.queues.readQueue(gameId, account);
    if (queue?.items.some((item) => item.action === 'lock'))
      await this.session.requireLockSupport();
    if (!queue?.items.length)
      throw new DesktopError('EMPTY_QUEUE', 'Add an achievement to the queue first.');
    const token = randomUUID();
    const draft = await this.store.draftPath(account, gameId);
    const snapshot = await this.store.snapshot(account, token, draft);
    const report = reportSchema.parse(
      requireSuccess(await this.cli.run({ kind: 'queue-preview', file: snapshot.path })),
    ) as Report;
    this.session.assertOwner(report.user_id, account);
    validateReport(report, queue, true);
    this.previews.save({
      token,
      path: snapshot.path,
      draft,
      digest: snapshot.digest,
      queue,
      report,
    });
    return { token, report };
  }
  async apply({ previewToken }: { previewToken: string }): Promise<ApplyResult> {
    tokenSchema.parse(previewToken);
    const preview = this.previews.consume(previewToken);
    const account = await this.session.requireAccount();
    this.session.assertOwner(account, preview.queue.user_id);
    if (
      digestBytes(await this.store.bytes(preview.path)) !== preview.digest ||
      digestBytes(await this.store.bytes(preview.draft)) !== preview.digest
    )
      throw new DesktopError(
        'STALE_PREVIEW',
        'Your queue changed. Select Apply changes to review it again.',
      );
    if (!preview.report.results.some((item) => item.status === 'pending'))
      throw new DesktopError(
        'NOTHING_TO_APPLY',
        'All selected achievements already have the requested state.',
      );
    const record: StoredOperation = {
      id: previewToken,
      user_id: account,
      game_id: preview.queue.game.id,
      game_title: preview.queue.game.title,
      started_at: new Date().toISOString(),
      finished_at: null,
      state: 'running',
      report: null,
      digest: preview.digest,
      process: null,
    };
    await this.store.saveOperation(record);
    this.operations.publish({
      kind: 'apply',
      operationId: record.id,
      gameId: record.game_id,
      startedAt: record.started_at,
    });
    try {
      const outcome = await this.cli.run({ kind: 'queue-apply', file: preview.path }, async () => {
        const found = await this.probe.find(preview.path);
        if (found.state === 'alive') record.process = found.identity;
        await this.store.saveOperation(record);
      });
      const raw = outcome.result.ok
        ? outcome.result.data
        : outcome.exitCode === 6 && outcome.result.error.code === 'APPLY_INCOMPLETE'
          ? (outcome.result.error.details as { report?: unknown } | undefined)?.report
          : undefined;
      if (raw !== undefined) {
        const report = reportSchema.parse(raw) as Report;
        this.session.assertOwner(report.user_id, account);
        validateReport(report, preview.queue, false);
        if ((outcome.exitCode === 0) !== report.complete)
          throw new DesktopError(
            'INVALID_APPLY_REPORT',
            'Could not confirm these changes. Refresh achievements before trying again.',
          );
        record.report = report;
        record.state = 'complete';
        if (!report.complete) record.error = publicError(cliError('APPLY_INCOMPLETE'));
      } else {
        record.state = 'unknown';
        record.error = outcome.result.ok
          ? {
              code: 'INVALID_APPLY_REPORT',
              message: 'Could not confirm these changes. Refresh achievements before trying again.',
            }
          : publicError(cliError(outcome.result.error.code));
      }
    } catch (error) {
      record.state = 'unknown';
      record.error = publicError(error);
    }
    record.finished_at = new Date().toISOString();
    try {
      await this.store.saveOperation(record);
    } catch {
      throw new DesktopError(
        'REPORT_SAVE_FAILED',
        'The result could not be saved. Refresh achievements before trying again.',
      );
    }
    if (record.report) {
      try {
        await this.store.clearConfirmedItems(preview.queue, record.report);
      } catch {
        record.error = {
          code: 'QUEUE_CLEANUP_FAILED',
          message:
            'Your results were saved, but the queue could not be updated. Review it before trying again.',
        };
        // The confirmed report is already durable even if saving this warning fails.
        await this.store.saveOperation(record).catch(() => {});
      }
    }
    return {
      operationId: record.id,
      state: record.state === 'complete' ? 'complete' : 'unknown',
      report: record.report,
      ...(record.error ? { error: record.error } : {}),
    };
  }
}
