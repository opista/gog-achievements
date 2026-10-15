import type {
  ApplyResult,
  PreviewResult,
  Report,
  UnlockReportStatus,
} from '../../../src/shared/api';

export function report(status: UnlockReportStatus = 'pending', gameId = '1'): Report {
  return {
    dry_run: status === 'pending',
    user_id: '123456789',
    game: { id: gameId, title: `Game ${gameId}`, client_id: `10000${gameId}` },
    complete: true,
    results: [
      {
        achievement_id: '1',
        name: 'Earned achievement',
        status,
        requested_unlocked_at: '2020-01-01T00:00:00Z',
        previous_unlocked_at: null,
        actual_unlocked_at: status === 'restored' ? '2020-01-01T00:00:00Z' : null,
      },
    ],
  };
}
export function preview(gameId = '1'): PreviewResult {
  return { token: `reviewed-${gameId}`, report: report('pending', gameId) };
}
export function applied(gameId = '1'): ApplyResult {
  return { operationId: 'operation-1', state: 'complete', report: report('restored', gameId) };
}
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (failure: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
