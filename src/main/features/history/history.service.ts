import { Inject, Injectable } from '@nestjs/common';
import type { OperationRecord } from '../../../shared/api';
import { historyInputSchema } from '../../../shared/schemas';
import { QueueStore } from '../../queue-store';
import { SessionService } from '../account/session.service';
@Injectable()
export class HistoryService {
  constructor(
    @Inject(QueueStore) private readonly store: QueueStore,
    @Inject(SessionService) private readonly session: SessionService,
  ) {}
  async list(input: { gameId?: string }): Promise<OperationRecord[]> {
    const { gameId } = historyInputSchema.parse(input);
    const account = await this.session.requireAccount();
    return (await this.store.operations(account))
      .filter((record) => gameId === undefined || record.game_id === gameId)
      .map((record) => this.store.publicRecord(record));
  }
}
