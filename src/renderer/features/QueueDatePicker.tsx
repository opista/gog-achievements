import { useId, useMemo, useRef, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import type { QueueItem } from '../../shared/api';
import { localFields, offsetLabel, resolveLocalDate } from '../date-time';
import './QueueDatePicker.css';

interface Props {
  item: QueueItem;
  zone: string;
  busy: boolean;
  onSave(iso: string): Promise<boolean>;
}

function nativeValue(iso: string, zone: string): string {
  const fields = localFields(iso, zone);
  return `${fields.date}T${fields.time}`;
}

function completeSeconds(value: string): string {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) ? `${value}:00` : value;
}

function resolveValue(value: string, zone: string, offset?: number) {
  const [date = '', time = ''] = completeSeconds(value).split('T');
  return resolveLocalDate({ date, time }, zone, offset);
}

/** Reset local edits when the saved instant or display zone changes. */
export function QueueDatePicker(props: Props) {
  return (
    <DateField
      key={`${props.item.achievement_id}:${props.zone}:${props.item.unlocked_at}`}
      {...props}
    />
  );
}

function DateField({ item, zone, busy, onSave }: Props) {
  const messageId = useId();
  const [savedIso, setSavedIso] = useState(item.unlocked_at);
  const savedValue = useMemo(() => nativeValue(savedIso, zone), [savedIso, zone]);
  const [value, setValue] = useState(() => savedValue);
  const [offset, setOffset] = useState<number>();
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');
  const inFlight = useRef(false);
  const resolution = useMemo(
    () => (value === savedValue ? null : resolveValue(value, zone, offset)),
    [value, savedValue, zone, offset],
  );
  const error = status === 'failed' ? 'The date could not be saved. Try again.' : resolution?.error;
  const saving = status === 'saving';

  async function save(iso = resolution?.iso) {
    if (!iso || Date.parse(iso) === Date.parse(savedIso) || busy || inFlight.current) return;
    inFlight.current = true;
    setStatus('saving');
    try {
      if (await onSave(iso)) {
        setSavedIso(iso);
        setValue(nativeValue(iso, zone));
        setOffset(undefined);
        setStatus('saved');
      } else setStatus('failed');
    } catch {
      setStatus('failed');
    } finally {
      inFlight.current = false;
    }
  }

  return (
    <div className="queue-date-picker" aria-busy={saving}>
      <div className="queue-date-picker-controls">
        <input
          type="datetime-local"
          step="1"
          aria-label={`Unlock date for ${item.name}`}
          aria-invalid={Boolean(resolution?.error)}
          aria-describedby={error || status !== 'idle' ? messageId : undefined}
          title={zone}
          value={value}
          disabled={busy || saving}
          onChange={(event) => {
            setValue(completeSeconds(event.target.value));
            setOffset(undefined);
            setStatus('idle');
          }}
          onBlur={() => void save()}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              void save();
            } else if (event.key === 'Escape') {
              event.preventDefault();
              setValue(savedValue);
              setOffset(undefined);
              setStatus('idle');
            }
          }}
        />
        {resolution && resolution.choices.length > 1 ? (
          <select
            aria-label={`UTC offset for ${item.name}`}
            value={offset ?? ''}
            disabled={busy || saving}
            onChange={(event) => {
              const selected = event.target.value === '' ? undefined : Number(event.target.value);
              setOffset(selected);
              setStatus('idle');
              if (selected !== undefined) void save(resolveValue(value, zone, selected).iso);
            }}
            onBlur={() => void save()}
          >
            <option value="">UTC offset</option>
            {resolution.choices.map((choice) => (
              <option key={choice} value={choice}>
                {offsetLabel(choice)}
              </option>
            ))}
          </select>
        ) : null}
        {saving ? <LoaderCircle className="queue-date-spinner" size={14} aria-hidden /> : null}
      </div>
      {error || status !== 'idle' ? (
        <span
          id={messageId}
          className={error ? 'queue-date-message queue-date-error' : 'queue-date-message'}
          role="status"
        >
          {error ?? (saving ? 'Saving…' : 'Saved')}
        </span>
      ) : null}
    </div>
  );
}
