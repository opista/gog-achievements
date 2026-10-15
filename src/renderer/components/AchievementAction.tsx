import { LockKeyhole, LockKeyholeOpen } from 'lucide-react';
import type { AchievementAction } from '../../shared/api';

export function AchievementActionIcon({
  action,
  size = 16,
}: {
  action: AchievementAction;
  size?: number;
}) {
  const Icon = action === 'lock' ? LockKeyhole : LockKeyholeOpen;
  return <Icon size={size} aria-hidden="true" />;
}

export function AchievementActionLabel({
  action,
  label,
  className = '',
  title,
}: {
  action: AchievementAction;
  label?: string;
  className?: string;
  title?: string;
}) {
  return (
    <span
      className={`achievement-action-label achievement-action-${action} ${className}`}
      title={title}
    >
      <AchievementActionIcon action={action} size={14} />
      <span>{label ?? (action === 'lock' ? 'Lock' : 'Unlock')}</span>
    </span>
  );
}
