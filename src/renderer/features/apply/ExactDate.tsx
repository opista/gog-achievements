import { formatTimestamp } from '../../date-time';

export function ExactDate({ iso, zone }: { iso: string | null; zone: string }) {
  if (!iso) return <span className="muted">Not confirmed</span>;
  return (
    <time className="exact-date" dateTime={iso}>
      {formatTimestamp(iso, zone)}
    </time>
  );
}
