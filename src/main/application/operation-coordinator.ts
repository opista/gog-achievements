import { Injectable } from '@nestjs/common';
import type { OperationState } from '../../shared/api';
import { DesktopError } from '../errors';

// One instance owns the lock and events for every workspace feature.
@Injectable()
export class OperationCoordinator {
  private operation: OperationState = { kind: 'idle' };
  private listeners = new Set<(state: OperationState) => void>();
  get current(): OperationState {
    return { ...this.operation };
  }
  onOperation(listener: (state: OperationState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  publish(state: OperationState): void {
    this.operation = state;
    for (const listener of this.listeners) {
      try {
        listener({ ...state });
      } catch {
        // A disconnected observer must not interrupt a write.
      }
    }
  }
  async run<T>(
    kind: 'read' | 'login' | 'apply',
    action: () => Promise<T>,
    gameId?: string,
  ): Promise<T> {
    if (this.operation.kind !== 'idle')
      throw new DesktopError(
        'BUSY',
        'Another action is in progress. Please wait for it to finish.',
      );
    this.publish({ kind, ...(gameId ? { gameId } : {}), startedAt: new Date().toISOString() });
    try {
      return await action();
    } finally {
      if (this.current.kind !== 'recovery') this.publish({ kind: 'idle' });
    }
  }
}
