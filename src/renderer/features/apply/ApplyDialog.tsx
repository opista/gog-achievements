import type { Achievement, ApplyResult, Report } from '../../../shared/api';
import { Dialog } from '../../components/Dialog';
import { ApplyReview } from './ApplyReview';
import { ApplyProgress } from './ApplyProgress';
import { Results } from './Results';
import { summarizeApplyResult } from './apply-model';

export function ApplyDialog({
  report,
  result = null,
  gameTitle,
  applying = false,
  recovering = false,
  signedIn = true,
  zone,
  demo,
  busy,
  achievementFor,
  onClose,
  onApply,
  onHistory,
  onCheckCurrentState,
  refreshError,
}: {
  report: Report | null;
  result?: ApplyResult | null;
  gameTitle?: string;
  applying?: boolean;
  recovering?: boolean;
  signedIn?: boolean;
  zone: string;
  demo: boolean;
  busy: boolean;
  achievementFor(gameId: string, achievementId: string): Achievement | undefined;
  onClose(): void;
  onApply(): void;
  onHistory(): void;
  onCheckCurrentState(): void;
  refreshError?: string;
}) {
  const phase = applying ? 'applying' : result ? 'result' : 'review';
  const count = report?.results.filter((item) => item.status === 'pending').length ?? 0;
  const checking = recovering || !signedIn;
  const summary = result ? summarizeApplyResult(result) : null;
  const title =
    phase === 'applying'
      ? checking
        ? 'Checking previous changes…'
        : 'Applying changes…'
      : result
        ? summary!.title
        : `Apply changes to ${count} achievement${count === 1 ? '' : 's'}?`;
  const blocked = busy || applying;
  return (
    <Dialog
      title={title}
      busy={blocked}
      compact={phase !== 'review'}
      focusKey={phase}
      onClose={onClose}
      footer={
        phase === 'applying' ? (
          <span className="muted">Please keep the app open.</span>
        ) : phase === 'review' ? (
          <>
            <button data-initial-focus disabled={blocked} onClick={onClose}>
              Cancel
            </button>
            <button className="primary" disabled={blocked || count === 0} onClick={onApply}>
              Apply changes
            </button>
          </>
        ) : (
          <>
            <button disabled={blocked} onClick={onHistory}>
              View history
            </button>
            {summary?.attention || refreshError ? (
              <button disabled={blocked} onClick={onCheckCurrentState}>
                Check current state
              </button>
            ) : null}
            <button className="primary" data-initial-focus disabled={blocked} onClick={onClose}>
              Done
            </button>
          </>
        )
      }
    >
      {phase === 'review' && report ? (
        <ApplyReview report={report} zone={zone} demo={demo} achievementFor={achievementFor} />
      ) : (
        <>
          {gameTitle || result?.report?.game.title ? (
            <h3 className="apply-game">{gameTitle ?? result?.report?.game.title}</h3>
          ) : null}
          {phase === 'applying' ? (
            <ApplyProgress signedIn={signedIn} recovering={recovering} />
          ) : result ? (
            <>
              <Results result={result} zone={zone} />
              {refreshError ? (
                <p className="info-note" role="alert">
                  The latest data could not be refreshed. {refreshError}
                </p>
              ) : null}
            </>
          ) : null}
        </>
      )}
    </Dialog>
  );
}
