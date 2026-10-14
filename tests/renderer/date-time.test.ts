import { describe, expect, it } from 'vitest';
import { localFields, resolveLocalDate, zoneLabel } from '../../src/renderer/date-time';
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
