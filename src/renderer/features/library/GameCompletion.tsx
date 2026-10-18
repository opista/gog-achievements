import { Check } from 'lucide-react';
import type { GameProgress } from './library-model';

interface Props {
  progress?: GameProgress;
}

export function GameCompletion({ progress }: Props) {
  if (!progress)
    return (
      <span className="game-completion">
        <span aria-hidden="true">—</span>
        <span className="sr-only">Achievement completion has not been loaded</span>
      </span>
    );
  if (progress.total === 0) return <span className="game-completion">No achievements</span>;
  const { unlocked, total, percentage } = progress;
  const complete = percentage === 100;
  return (
    <span className={`game-completion${complete ? ' complete' : ''}`}>
      <span className="sr-only">
        {unlocked} of {total} achievements unlocked, {percentage}% complete
      </span>
      <span aria-hidden="true">
        {unlocked}/{total} unlocked · <strong>{percentage}%</strong>
      </span>
      {complete ? <Check size={13} aria-hidden="true" /> : null}
    </span>
  );
}
