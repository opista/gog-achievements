import { describe, expect, it, vi } from 'vitest';
import {
  TIME_ZONES,
  detectTimeZone,
  formatTimestamp,
  localFields,
  resolveLocalDate,
  zoneLabel,
} from '../../src/renderer/date-time';
const NOW = Date.parse('2030-01-01T00:00:00Z');
describe('exact unlock dates', () => {
  it('round-trips a London date to second-precision UTC', () => {
    const result = resolveLocalDate(
      { date: '2026-10-10', time: '18:30:00' },
      'Europe/London',
      undefined,
      NOW,
    );
    expect(result.iso).toBe('2026-10-10T17:30:00Z');
    expect(localFields(result.iso!, 'Europe/London')).toEqual({
      date: '2026-10-10',
      time: '18:30:00',
    });
    expect(zoneLabel('Europe/London', result.iso!)).toBe('Europe/London (UTC+01:00)');
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
    ).toMatch(/valid time zone/);
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

describe('display time zones', () => {
  it('includes every Intl-supported zone, UTC and the detected user zone once', () => {
    expect(TIME_ZONES).toContain('UTC');
    expect(TIME_ZONES).toContain(detectTimeZone());
    expect(new Set(TIME_ZONES).size).toBe(TIME_ZONES.length);
    for (const zone of Intl.supportedValuesOf('timeZone')) expect(TIME_ZONES).toContain(zone);
    expect(TIME_ZONES).toContain('Asia/Colombo');
    expect(TIME_ZONES).toContain('America/St_Johns');
  });
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
    expect(formatTimestamp('2020-07-01T12:34:56Z', 'Pacific/Chatham')).toBe('02 Jul 2020 01:19:56');
    expect(formatTimestamp('2020-07-02T12:34:56Z', 'Pacific/Chatham')).toBe('03 Jul 2020 01:19:56');
    expect(formatTimestamp('2020-07-01T12:34:56Z', 'Pacific/Chatham', false)).toBe(
      '02 Jul 2020 01:19',
    );
    expect(constructor).toHaveBeenCalledTimes(2);
  });
});
