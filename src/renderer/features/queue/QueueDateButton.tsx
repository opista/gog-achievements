import { useMemo } from 'react';
import { CalendarDays } from 'lucide-react';
import { formatTimestamp, localTimeOccurrence } from '../../date-time';

interface Props {
  date: string;
  name: string;
  zone: string;
  disabled: boolean;
  onClick(): void;
}

export function QueueDateButton({ date, name, zone, disabled, onClick }: Props) {
  // Keep the label with its row. Busy state and dialog changes need no new DST search.
  const title = useMemo(
    () =>
      [formatTimestamp(date, zone), localTimeOccurrence(date, zone)].filter(Boolean).join(' · '),
    [date, zone],
  );
  return (
    <button
      className="icon-button"
      aria-label={`Edit date for ${name}`}
      title={title}
      disabled={disabled}
      onClick={onClick}
    >
      <CalendarDays size={18} />
    </button>
  );
}
