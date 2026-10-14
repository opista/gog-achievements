/** Convert local wall times by round-tripping offsets through the selected zone. */
const formatters = new Map<string, Intl.DateTimeFormat>();

export interface LocalFields {
  date: string;
  time: string;
}
export interface DateResolution {
  iso: string | null;
  choices: number[];
  error: string | null;
}

function formatter(zone: string): Intl.DateTimeFormat {
  let value = formatters.get(zone);
  if (!value) {
    value = new Intl.DateTimeFormat('en-GB', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    formatters.set(zone, value);
  }
  return value;
}

export function localFields(iso: string, zone: string): LocalFields {
  const parts = Object.fromEntries(
    formatter(zone)
      .formatToParts(new Date(iso))
      .map((part) => [part.type, part.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}:${parts.second}`,
  };
}

function wallEpoch(fields: LocalFields): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fields.date) || !/^\d{2}:\d{2}:\d{2}$/.test(fields.time))
    return null;
  const epoch = Date.parse(`${fields.date}T${fields.time}Z`);
  if (!Number.isFinite(epoch)) return null;
  const roundTrip = new Date(epoch).toISOString();
  return roundTrip.slice(0, 10) === fields.date && roundTrip.slice(11, 19) === fields.time
    ? epoch
    : null;
}

export function offsetLabel(seconds: number): string {
  const absolute = Math.abs(seconds);
  const hours = String(Math.floor(absolute / 3600)).padStart(2, '0');
  const minutes = String(Math.floor((absolute % 3600) / 60)).padStart(2, '0');
  return `UTC${seconds < 0 ? '-' : '+'}${hours}:${minutes}`;
}

export function resolveLocalDate(
  fields: LocalFields,
  zone: string,
  selectedOffset?: number,
  now = Date.now(),
): DateResolution {
  if (/^\d{4}-/.test(fields.date) && Number(fields.date.slice(0, 4)) < 1970)
    return { iso: null, choices: [], error: 'Unlock dates must be on or after 1 Jan 1970.' };
  const desired = wallEpoch(fields);
  if (desired === null)
    return { iso: null, choices: [], error: 'Enter a valid date and time, including seconds.' };
  try {
    const offsets = new Set<number>();
    // Sample both sides of possible daylight-saving or date-line changes.
    for (let hours = -48; hours <= 48; hours += 6) {
      const epoch = desired + hours * 3600000;
      const local = wallEpoch(localFields(new Date(epoch).toISOString(), zone));
      if (local !== null) offsets.add((local - epoch) / 1000);
    }
    const matches = [...offsets]
      .filter((offset) => {
        const actual = localFields(new Date(desired - offset * 1000).toISOString(), zone);
        return actual.date === fields.date && actual.time === fields.time;
      })
      .sort((a, b) => b - a);
    if (matches.length === 0)
      return {
        iso: null,
        choices: [],
        error: 'This local time does not exist in the selected zone.',
      };
    const offset = matches.length === 1 ? matches[0] : selectedOffset;
    if (offset === undefined || !matches.includes(offset))
      return {
        iso: null,
        choices: matches,
        error: 'This time occurs twice. Choose an explicit UTC offset.',
      };
    const epoch = desired - offset * 1000;
    if (epoch < 0)
      return {
        iso: null,
        choices: [],
        error: 'The UTC unlock date must be on or after 1 Jan 1970.',
      };
    if (epoch > now)
      return {
        iso: null,
        choices: matches.length > 1 ? matches : [],
        error: 'Unlock dates must not be in the future.',
      };
    return {
      iso: new Date(epoch).toISOString().replace('.000Z', 'Z'),
      choices: matches.length > 1 ? matches : [],
      error: null,
    };
  } catch {
    return { iso: null, choices: [], error: 'Choose a valid time zone.' };
  }
}

export function formatTimestamp(iso: string | null, zone: string, exact = true): string {
  if (!iso) return 'Not confirmed';
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return 'Date unavailable';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    ...(exact ? { second: '2-digit' as const } : {}),
    hourCycle: 'h23',
  })
    .format(date)
    .replace(',', '');
}

export function zoneLabel(zone: string, iso = new Date().toISOString()): string {
  const local = wallEpoch(localFields(iso, zone));
  const actual = Math.floor(Date.parse(iso) / 1000) * 1000;
  return `${zone} (${offsetLabel(((local ?? actual) - actual) / 1000)})`;
}

export const TIME_ZONES = [
  'Europe/London',
  'UTC',
  'Europe/Berlin',
  'America/New_York',
  'America/Los_Angeles',
  'Asia/Tokyo',
  'Australia/Sydney',
];
