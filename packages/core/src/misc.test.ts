import { describe, expect, it } from 'vitest';
import {
  addDays,
  dayOfWeek,
  diffDays,
  fromDayNumber,
  isIsoDate,
  monthOf,
  toDayNumber,
  todayIn,
} from './dates.js';
import { DEFAULT_ORIGIN, haversineMiles, parseLatLng } from './geo.js';
import { cents, formatCents, roundHalfEven } from './money.js';
import { hash32, pick, rand01, randInt } from './random.js';

describe('money', () => {
  it.each([
    [0.5, 0],
    [1.5, 2],
    [2.5, 2],
    [3.5, 4],
    [-0.5, 0],
    [2.4999, 2],
    [2.5000000001, 2],
    [2.51, 3],
    [249.5, 250],
    [248.5, 248],
  ])('roundHalfEven(%d) = %d', (input, expected) => {
    expect(roundHalfEven(input)).toBe(expected);
  });
  it('cents rejects fractions', () => {
    expect(() => cents(1.5)).toThrow(RangeError);
    expect(cents(150)).toBe(150);
  });
  it('formats', () => {
    expect(formatCents(0)).toBe('$0.00');
    expect(formatCents(389)).toBe('$3.89');
    expect(formatCents(123456)).toBe('$1,234.56');
    expect(formatCents(-705)).toBe('-$7.05');
  });
});

describe('dates', () => {
  it('validates ISO dates', () => {
    expect(isIsoDate('2026-11-16')).toBe(true);
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(isIsoDate('2026-1-1')).toBe(false);
  });
  it('day numbers round-trip and do arithmetic across DST and leap years', () => {
    expect(toDayNumber('1970-01-01')).toBe(0);
    expect(fromDayNumber(toDayNumber('2028-02-29'))).toBe('2028-02-29');
    expect(addDays('2026-03-07', 2)).toBe('2026-03-09');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(diffDays('2026-11-16', '2025-11-16')).toBe(365);
  });
  it('day of week and month', () => {
    expect(dayOfWeek('1970-01-01')).toBe(4); // Thursday
    expect(dayOfWeek('2026-11-16')).toBe(1); // Monday
    expect(dayOfWeek('2026-11-18')).toBe(3); // Wednesday
    expect(monthOf('2026-11-16')).toBe(11);
  });
  it('today is computed in America/Chicago', () => {
    // 2026-11-17 03:00 UTC is still the 16th in Chicago (UTC-6)
    expect(todayIn('America/Chicago', new Date('2026-11-17T03:00:00Z'))).toBe('2026-11-16');
  });
});

describe('geo', () => {
  it('haversine matches known distances', () => {
    // ~1 degree of latitude ≈ 69.09 miles
    expect(haversineMiles({ lat: 33, lng: -96.8 }, { lat: 34, lng: -96.8 })).toBeCloseTo(69.09, 1);
    expect(haversineMiles(DEFAULT_ORIGIN, DEFAULT_ORIGIN)).toBe(0);
  });
  it('parses lat,lng', () => {
    expect(parseLatLng('33.1500,-96.8065')).toEqual(DEFAULT_ORIGIN);
    expect(() => parseLatLng('91,0')).toThrow(RangeError);
    expect(() => parseLatLng('nope')).toThrow(RangeError);
  });
});

describe('random', () => {
  it('is deterministic and in range', () => {
    expect(hash32('abc')).toBe(hash32('abc'));
    expect(hash32('abc')).not.toBe(hash32('abd'));
    const values = Array.from({ length: 1000 }, (_, i) => rand01('seed', i));
    expect(Math.min(...values)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...values)).toBeLessThan(1);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    expect(mean).toBeGreaterThan(0.45);
    expect(mean).toBeLessThan(0.55);
  });
  it('randInt and pick stay in bounds', () => {
    for (let i = 0; i < 200; i++) {
      const n = randInt(3, 5, 'k', i);
      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThanOrEqual(5);
    }
    expect(['a', 'b']).toContain(pick(['a', 'b'], 'x'));
    expect(() => pick([], 'x')).toThrow(RangeError);
  });
});
