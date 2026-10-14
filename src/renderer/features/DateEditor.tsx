import { useState } from 'react';
import { CalendarDays, Info } from 'lucide-react';
import type { QueueItem } from '../../shared/api';
import { Dialog } from '../components/Dialog';
import {
  TIME_ZONES,
  formatTimestamp,
  localFields,
  offsetLabel,
  resolveLocalDate,
  zoneLabel,
  type LocalFields,
} from '../date-time';
function completeTime(value: string): string {
  return /^\d{2}:\d{2}$/.test(value) ? `${value}:00` : value;
}
interface Fields extends LocalFields {
  offset?: number;
}
interface Props {
  items: QueueItem[];
  zone: string;
  busy: boolean;
  onClose(): void;
  onSave(dates: Record<string, string>): Promise<boolean>;
  onZone(zone: string): void;
}
export function DateEditor({ items, zone: initialZone, busy, onClose, onSave, onZone }: Props) {
  const [zone, setZone] = useState(initialZone);
  const [fields, setFields] = useState<Record<string, Fields>>(() =>
    Object.fromEntries(
      items.map((item) => [item.achievement_id, localFields(item.unlocked_at, initialZone)]),
    ),
  );
  const [selected, setSelected] = useState(() => new Set(items.map((item) => item.achievement_id)));
  const [bulk, setBulk] = useState<Fields | null>(null);
  const resolutions = Object.fromEntries(
    items.map((item) => [
      item.achievement_id,
      resolveLocalDate(fields[item.achievement_id]!, zone, fields[item.achievement_id]?.offset),
    ]),
  );
  const invalid = items.some((item) => !resolutions[item.achievement_id]?.iso);
  function update(id: string, next: Partial<Fields>) {
    setFields((previous) => ({ ...previous, [id]: { ...previous[id]!, ...next } }));
  }
  function changeZone(next: string) {
    setFields((previous) =>
      Object.fromEntries(
        items.map((item) => {
          const value = previous[item.achievement_id]!;
          const iso = resolveLocalDate(value, zone, value.offset).iso ?? item.unlocked_at;
          return [item.achievement_id, localFields(iso, next)];
        }),
      ),
    );
    setZone(next);
    setBulk(null);
  }
  async function save() {
    if (invalid || busy) return;
    const dates = Object.fromEntries(
      items.map((item) => [item.achievement_id, resolutions[item.achievement_id]!.iso!]),
    );
    if (await onSave(dates)) {
      onZone(zone);
      onClose();
    }
  }
  const zones = [...new Set([zone, ...TIME_ZONES])];
  const bulkResolution = bulk ? resolveLocalDate(bulk, zone, bulk.offset) : null;
  return (
    <Dialog
      title="Queue dates"
      wide
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <button data-initial-focus disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button className="primary" disabled={busy || invalid} onClick={() => void save()}>
            {busy ? 'Saving dates…' : 'Save dates'}
          </button>
        </>
      }
    >
      <div className="date-intro">
        <div>
          <strong>{items.length} selected achievements</strong>
          <p>Set the dates for queued achievements.</p>
        </div>
        <label>
          Display time zone
          <select value={zone} disabled={busy} onChange={(event) => changeZone(event.target.value)}>
            {zones.map((value) => (
              <option key={value} value={value}>
                {zoneLabel(value)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <button
        disabled={busy || selected.size === 0}
        onClick={() =>
          setBulk(fields[items.find((item) => selected.has(item.achievement_id))!.achievement_id]!)
        }
      >
        <CalendarDays size={18} />
        Set date for selected
      </button>
      {bulk ? (
        <div className="bulk-fields">
          <strong>Common date for {selected.size} rows</strong>
          <label>
            Date
            <input
              type="date"
              value={bulk.date}
              onChange={(event) =>
                setBulk({ ...bulk, date: event.target.value, offset: undefined })
              }
            />
          </label>
          <label>
            Time
            <input
              type="time"
              step="1"
              value={bulk.time}
              onChange={(event) =>
                setBulk({ ...bulk, time: completeTime(event.target.value), offset: undefined })
              }
            />
          </label>
          {bulkResolution && bulkResolution.choices.length > 1 ? (
            <label>
              Explicit offset
              <select
                value={bulk.offset ?? ''}
                onChange={(event) =>
                  setBulk({
                    ...bulk,
                    offset: event.target.value === '' ? undefined : Number(event.target.value),
                  })
                }
              >
                <option value="">Choose offset</option>
                {bulkResolution.choices.map((offset) => (
                  <option key={offset} value={offset}>
                    {offsetLabel(offset)}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <button
            disabled={!bulkResolution?.iso}
            onClick={() => {
              setFields((previous) => ({
                ...previous,
                ...Object.fromEntries([...selected].map((id) => [id, { ...bulk }])),
              }));
              setBulk(null);
            }}
          >
            Use for selected
          </button>
          <button onClick={() => setBulk(null)}>Close</button>
          {bulkResolution?.error ? <p className="field-error">{bulkResolution.error}</p> : null}
        </div>
      ) : null}
      <div className="date-table-wrap">
        <table className="date-table">
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  aria-label="Select all queue dates"
                  checked={selected.size === items.length}
                  onChange={(event) =>
                    setSelected(
                      event.target.checked
                        ? new Set(items.map((item) => item.achievement_id))
                        : new Set(),
                    )
                  }
                />
              </th>
              <th>Achievement</th>
              <th>Unlock date</th>
              <th>Time</th>
              <th>UTC equivalent</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const id = item.achievement_id;
              const value = fields[id]!;
              const resolution = resolutions[id]!;
              return (
                <tr key={id}>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Select date for ${item.name}`}
                      checked={selected.has(id)}
                      onChange={(event) =>
                        setSelected((previous) => {
                          const next = new Set(previous);
                          if (event.target.checked) next.add(id);
                          else next.delete(id);
                          return next;
                        })
                      }
                    />
                  </td>
                  <th scope="row">{item.name}</th>
                  <td>
                    <input
                      aria-label={`Unlock date for ${item.name}`}
                      type="date"
                      value={value.date}
                      disabled={busy}
                      onChange={(event) =>
                        update(id, { date: event.target.value, offset: undefined })
                      }
                    />
                  </td>
                  <td>
                    <input
                      aria-label={`Unlock time for ${item.name}`}
                      type="time"
                      step="1"
                      value={value.time}
                      disabled={busy}
                      onChange={(event) =>
                        update(id, { time: completeTime(event.target.value), offset: undefined })
                      }
                    />
                    {resolution.choices.length > 1 ? (
                      <select
                        aria-label={`UTC offset for ${item.name}`}
                        value={value.offset ?? ''}
                        disabled={busy}
                        onChange={(event) =>
                          update(id, {
                            offset:
                              event.target.value === '' ? undefined : Number(event.target.value),
                          })
                        }
                      >
                        <option value="">Choose offset</option>
                        {resolution.choices.map((offset) => (
                          <option key={offset} value={offset}>
                            {offsetLabel(offset)}
                          </option>
                        ))}
                      </select>
                    ) : null}
                  </td>
                  <td>
                    {resolution.iso ? (
                      <span className="utc-value">
                        {formatTimestamp(resolution.iso, 'UTC')} UTC
                      </span>
                    ) : (
                      <span className="field-error" role="status">
                        {resolution.error}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="info-note">
        <Info size={20} />
        <span>
          <strong>Existing unlocked achievements keep their dates.</strong>
          <br />
          Dates apply only to queued achievements that are still locked.
        </span>
      </p>
    </Dialog>
  );
}
