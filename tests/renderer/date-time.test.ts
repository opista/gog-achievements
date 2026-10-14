import { describe, expect, it, vi } from 'vitest';
import {
  detectTimeZone,
  formatTimestamp,
  formatDate,
  localFields,
  localTimeOccurrence,
  offsetLabel,
  resolveLocalDate,
} from '../../src/renderer/date-time';
const NOW = Date.parse('2030-01-01T00:00:00Z');
describe('exact unlock dates', () => {
  it('round-trips a London date to second-precision UTC', () => {
    const result = resolveLocalDate(
      { date: '2026-10-10', time: '18:30:47' },
      'Europe/London',
      undefined,
      NOW,
    );
    expect(result.iso).toBe('2026-10-10T17:30:47Z');
    expect(localFields(result.iso!, 'Europe/London')).toEqual({
      date: '2026-10-10',
      time: '18:30:47',
    });
  });
  it('accepts leap days and rejects invalid calendar dates', () => {
    expect(
      resolveLocalDate({ date: '2024-02-29', time: '12:00:00' }, 'UTC', undefined, NOW).iso,
    ).toBe('2024-02-29T12:00:00Z');
    expect(
      resolveLocalDate({ date: '2023-02-29', time: '12:00:00' }, 'UTC', undefined, NOW).iso,
    ).toBeNull();
    expect(
      resolveLocalDate({ date: '2024-02-30', time: '12:00:00' }, 'UTC', undefined, NOW).iso,
    ).toBeNull();
  });
  it('rejects nonexistent daylight-saving wall times', () => {
    const result = resolveLocalDate(
      { date: '2026-03-29', time: '01:30:00' },
      'Europe/London',
      undefined,
      NOW,
    );
    expect(result.iso).toBeNull();
    expect(result.error).toMatch(/does not exist/);
  });
  it('requires an explicit offset for an ambiguous wall time', () => {
    const fields = { date: '2026-10-25', time: '01:30:00' };
    expect(resolveLocalDate(fields, 'Europe/London', undefined, NOW).choices).toEqual([3600, 0]);
    expect(resolveLocalDate(fields, 'Europe/London', undefined, NOW).iso).toBeNull();
    expect(resolveLocalDate(fields, 'Europe/London', 1800, NOW).iso).toBeNull();
    expect(resolveLocalDate(fields, 'Europe/London', 3600, NOW).iso).toBe('2026-10-25T00:30:00Z');
    expect(resolveLocalDate(fields, 'Europe/London', 0, NOW).iso).toBe('2026-10-25T01:30:00Z');
  });
  it('handles fractional-hour zones and rejects future dates and bad zones', () => {
    expect(
      resolveLocalDate({ date: '2026-10-10', time: '18:30:00' }, 'Asia/Kathmandu', undefined, NOW)
        .iso,
    ).toBe('2026-10-10T12:45:00Z');
    expect(
      resolveLocalDate({ date: '2031-01-01', time: '00:00:00' }, 'UTC', undefined, NOW).error,
    ).toMatch(/future/);
    expect(
      resolveLocalDate({ date: '2026-10-10', time: '18:30:00' }, 'Unknown/Zone', undefined, NOW)
        .error,
    ).toMatch(/time zone is unavailable/);
  });
  it('matches the CLI minimum timestamp, including UTC offset conversion', () => {
    expect(
      resolveLocalDate({ date: '1969-12-31', time: '12:00:00' }, 'UTC', undefined, NOW).error,
    ).toMatch(/1970/);
    expect(
      resolveLocalDate({ date: '1970-01-01', time: '00:00:00' }, 'UTC', undefined, NOW).iso,
    ).toBe('1970-01-01T00:00:00Z');
    expect(
      resolveLocalDate({ date: '1970-01-01', time: '00:00:00' }, 'Asia/Tokyo', undefined, NOW)
        .error,
    ).toMatch(/UTC unlock date/);
  });
});

describe('local time detection and formatting', () => {
  it('falls back to UTC when the browser cannot report its zone', () => {
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementationOnce(() => {
      throw new Error('Fixture unavailable zone');
    });
    expect(detectTimeZone()).toBe('UTC');
  });
  it('falls back to UTC for an empty or invalid reported zone', () => {
    const options = Intl.DateTimeFormat().resolvedOptions();
    const resolved = vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions');
    resolved.mockReturnValueOnce({ ...options, timeZone: '' });
    expect(detectTimeZone()).toBe('UTC');
    resolved.mockReturnValueOnce({ ...options, timeZone: 'Unknown/Zone' });
    expect(detectTimeZone()).toBe('UTC');
  });
  it('reuses timestamp formatters while retaining exact and concise display modes', () => {
    const constructor = vi.spyOn(Intl, 'DateTimeFormat');
    expect(formatTimestamp('2020-07-01T12:34:56Z', 'Pacific/Chatham', true, 'en-GB')).toBe(
      '2 Jul 2020, 01:19:56',
    );
    expect(formatTimestamp('2020-07-02T12:34:56Z', 'Pacific/Chatham', true, 'en-GB')).toBe(
      '3 Jul 2020, 01:19:56',
    );
    expect(formatTimestamp('2020-07-01T12:34:56Z', 'Pacific/Chatham', false, 'en-GB')).toBe(
      '2 Jul 2020, 01:19',
    );
    expect(formatDate('2020-07-01T12:34:56Z', 'Pacific/Chatham', 'en-GB')).toBe('2 Jul 2020');
    expect(formatDate('2020-07-02T12:34:56Z', 'Pacific/Chatham', 'en-GB')).toBe('3 Jul 2020');
    expect(constructor).toHaveBeenCalledTimes(3);
  });
});

it('formats UTC offsets with a sign and fixed hour/minute digits', () => {
  expect(offsetLabel(0)).toBe('UTC+00:00');
  expect(offsetLabel(19800)).toBe('UTC+05:30');
  expect(offsetLabel(20700)).toBe('UTC+05:45');
  expect(offsetLabel(-12600)).toBe('UTC-03:30');
});

it.each([
  ['UTC', '2020-01-01T00:00:07Z', { date: '2020-01-01', time: '00:00:07' }],
  ['Pacific/Marquesas', '2020-01-01T01:00:07Z', { date: '2019-12-31', time: '15:30:07' }],
  ['Asia/Kathmandu', '2020-01-01T23:30:07Z', { date: '2020-01-02', time: '05:15:07' }],
] as const)(
  'round-trips UTC through %s across calendar boundaries with exact seconds',
  (zone, iso, fields) => {
    expect(localFields(iso, zone)).toEqual(fields);
    expect(resolveLocalDate(fields, zone, undefined, NOW).iso).toBe(iso);
  },
);

it('uses a valid machine-reported local zone without replacing it with UTC', () => {
  const options = Intl.DateTimeFormat().resolvedOptions();
  vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValueOnce({
    ...options,
    timeZone: 'Pacific/Marquesas',
  });
  const zone = detectTimeZone();
  expect(zone).toBe('Pacific/Marquesas');
  expect(formatTimestamp('2020-01-01T01:00:07Z', zone, true, 'en-GB')).toBe(
    '31 Dec 2019, 15:30:07',
  );
});

it('formats unavailable timestamps without exposing an invalid date', () => {
  expect(formatTimestamp(null, 'UTC')).toBe('Not confirmed');
  expect(formatTimestamp('not-a-date', 'UTC')).toBe('Date unavailable');
  expect(formatDate(null, 'UTC')).toBe('Not confirmed');
  expect(formatDate('not-a-date', 'UTC')).toBe('Date unavailable');
});

it.each([
  ['2020-11-01T05:30:00Z', 'America/New_York', 'First occurrence'],
  ['2020-11-01T06:30:00Z', 'America/New_York', 'Second occurrence'],
  ['2020-11-01T05:30:00.987Z', 'America/New_York', 'First occurrence'],
  ['2020-11-01T06:30:00.123Z', 'America/New_York', 'Second occurrence'],
  ['2020-10-25T00:30:00Z', 'Europe/London', 'First occurrence'],
  ['2020-10-25T01:30:00Z', 'Europe/London', 'Second occurrence'],
  ['2020-11-01T07:30:00Z', 'America/New_York', null],
  ['2020-11-01T05:30:00Z', 'UTC', null],
  ['2020-11-01T05:30:00Z', 'Asia/Kathmandu', null],
] as const)('labels %s in %s only when its local time repeats', (iso, zone, expected) => {
  expect(localTimeOccurrence(iso, zone)).toBe(expected);
});

it('does not label unavailable date or zone information as a repeated time', () => {
  expect(localTimeOccurrence('not-a-date', 'America/New_York')).toBeNull();
  expect(localTimeOccurrence('2020-11-01T05:30:00Z', 'Unknown/Zone')).toBeNull();
});

it.each([
  ['en-US', 'Jul 1, 2020, 12:34:56 PM', 'Jul 1, 2020, 12:34 PM', 'Jul 1, 2020'],
  ['en-GB', '1 Jul 2020, 12:34:56', '1 Jul 2020, 12:34', '1 Jul 2020'],
  ['fr-FR', '1 juil. 2020, 12:34:56', '1 juil. 2020, 12:34', '1 juil. 2020'],
  ['ja-JP', '2020/07/01 12:34:56', '2020/07/01 12:34', '2020/07/01'],
] as const)(
  'preserves %s date order, punctuation and default clock',
  (locale, exact, concise, date) => {
    const iso = '2020-07-01T12:34:56Z';
    expect(formatTimestamp(iso, 'UTC', true, locale)).toBe(exact);
    expect(formatTimestamp(iso, 'UTC', false, locale)).toBe(concise);
    expect(formatDate(iso, 'UTC', locale)).toBe(date);
  },
);

it('uses the default Intl locale when no display locale is supplied', () => {
  const iso = '2020-07-01T12:34:56Z';
  const value = new Date(iso);
  expect(formatTimestamp(iso, 'UTC')).toBe(
    new Intl.DateTimeFormat(undefined, {
      timeZone: 'UTC',
      dateStyle: 'medium',
      timeStyle: 'medium',
    }).format(value),
  );
  expect(formatDate(iso, 'UTC')).toBe(
    new Intl.DateTimeFormat(undefined, {
      timeZone: 'UTC',
      dateStyle: 'medium',
    }).format(value),
  );
});

it('respects twelve- and twenty-four-hour locale preferences at midnight', () => {
  const iso = '2020-07-01T00:04:07Z';
  expect(formatTimestamp(iso, 'UTC', true, 'en-US')).toBe('Jul 1, 2020, 12:04:07 AM');
  expect(formatTimestamp(iso, 'UTC', true, 'en-GB')).toBe('1 Jul 2020, 00:04:07');
  expect(formatTimestamp(iso, 'UTC', true, 'en-US-u-hc-h23')).toBe('Jul 1, 2020, 00:04:07');
});

it('keeps native date fields Gregorian, Latin and h23 regardless of display locale', () => {
  const iso = '2020-12-31T15:04:07Z';
  formatTimestamp(iso, 'Asia/Tokyo', true, 'th-TH-u-ca-buddhist-nu-thai');
  const fields = localFields(iso, 'Asia/Tokyo');
  expect(fields).toEqual({ date: '2021-01-01', time: '00:04:07' });
  expect(resolveLocalDate(fields, 'Asia/Tokyo', undefined, NOW).iso).toBe(iso);
});

it('isolates cached locales and reuses their date and time formatters', () => {
  const iso = '2020-07-01T12:34:56Z';
  const locales = ['en-US', 'en-GB', 'fr-FR'];
  const expected = locales.map((locale) => [
    formatTimestamp(iso, 'Asia/Colombo', true, locale),
    formatDate(iso, 'Asia/Colombo', locale),
  ]);
  const create = vi.spyOn(Intl, 'DateTimeFormat');
  for (const [index, locale] of locales.entries()) {
    expect(formatTimestamp(iso, 'Asia/Colombo', true, locale)).toBe(expected[index]?.[0]);
    expect(formatDate(iso, 'Asia/Colombo', locale)).toBe(expected[index]?.[1]);
  }
  expect(create).not.toHaveBeenCalled();
});
