import { useId, useMemo, useRef, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import type { QueueItem } from '../../shared/api';
import { Dialog } from '../components/Dialog';
import { localFields, localTimeOccurrence, offsetLabel, resolveLocalDate } from '../date-time';
import './QueueDateModal.css';

interface Props {
  item: QueueItem;
  description?: string;
  zone: string;
  busy: boolean;
  onSave(iso: string): Promise<boolean>;
  onClose(): void;
}

function nativeValue(iso: string, zone: string): string {
  const { date, time } = localFields(iso, zone);
  return `${date}T${time}`;
}

function completeSeconds(value: string): string {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) ? `${value}:00` : value;
}

export function QueueDateModal(props: Props) {
  return (
    <DateModal
      key={`${props.item.achievement_id}:${props.zone}:${props.item.unlocked_at}`}
      {...props}
    />
  );
}

function DateModal({ item, description, zone, busy, onSave, onClose }: Props) {
  const messageId = useId();
  const initialValue = useMemo(() => nativeValue(item.unlocked_at, zone), [item.unlocked_at, zone]);
  const [value, setValue] = useState(() => initialValue);
  const [offset, setOffset] = useState<number>();
  const [status, setStatus] = useState<'idle' | 'saving' | 'failed'>('idle');
  const inFlight = useRef(false);
  const resolution = useMemo(() => {
    // The saved instant already identifies its offset, including repeated wall times.
    if (value === initialValue) return { iso: item.unlocked_at, choices: [], error: null };
    const [date = '', time = ''] = value.split('T');
    return resolveLocalDate({ date, time }, zone, offset);
  }, [value, initialValue, item.unlocked_at, zone, offset]);
  const saving = status === 'saving';
  const locked = busy || saving;
  const error =
    status === 'failed'
      ? 'The date could not be saved. Try again.'
      : saving
        ? null
        : resolution.error;
  const changed = resolution.iso && Date.parse(resolution.iso) !== Date.parse(item.unlocked_at);
  const savedOccurrence =
    value === initialValue ? localTimeOccurrence(item.unlocked_at, zone) : null;

  async function save(iso: string | null) {
    if (!iso || locked || inFlight.current) return;
    inFlight.current = true;
    setStatus('saving');
    try {
      if (await onSave(iso)) onClose();
      else setStatus('failed');
    } catch {
      setStatus('failed');
    } finally {
      inFlight.current = false;
    }
  }

  return (
    <div className="queue-date-dialog">
      <Dialog
        title="Edit unlock date"
        busy={locked}
        onClose={onClose}
        footer={
          <>
            <button data-initial-focus disabled={locked} onClick={onClose}>
              Cancel
            </button>
            <button
              disabled={locked}
              onClick={() =>
                void save(new Date(Date.now()).toISOString().replace(/\.\d{3}Z$/, 'Z'))
              }
            >
              Use current time
            </button>
            <button
              className="primary"
              disabled={locked || !resolution.iso || !changed}
              onClick={() => void save(resolution.iso)}
            >
              {saving ? <LoaderCircle className="spinner" size={16} aria-hidden /> : null}
              Save date
            </button>
          </>
        }
      >
        <div className="queue-date-modal">
          <div className="queue-date-item">
            <strong>{item.name}</strong>
            <p>{description || 'No description available.'}</p>
          </div>
          <label>
            Unlock date and time (local)
            <input
              type="datetime-local"
              step="1"
              aria-label={`Unlock date for ${item.name}`}
              aria-invalid={Boolean(resolution.error)}
              aria-describedby={error || saving ? messageId : undefined}
              value={value}
              disabled={locked}
              onChange={(event) => {
                setValue(completeSeconds(event.target.value));
                setOffset(undefined);
                setStatus('idle');
              }}
            />
          </label>
          {savedOccurrence ? <small>{savedOccurrence}</small> : null}
          {resolution.choices.length > 1 ? (
            <label>
              UTC offset
              <select
                aria-label={`UTC offset for ${item.name}`}
                value={offset ?? ''}
                disabled={locked}
                onChange={(event) => {
                  setOffset(event.target.value === '' ? undefined : Number(event.target.value));
                  setStatus('idle');
                }}
              >
                <option value="">Choose offset</option>
                {resolution.choices.map((choice) => (
                  <option key={choice} value={choice}>
                    {offsetLabel(choice)}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {error || saving ? (
            <p id={messageId} className={error ? 'field-error' : 'muted'} role="status">
              {error ?? 'Saving date…'}
            </p>
          ) : null}
        </div>
      </Dialog>
    </div>
  );
}
