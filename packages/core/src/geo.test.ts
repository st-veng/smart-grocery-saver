import { describe, expect, it } from 'vitest';
import { DEFAULT_ORIGIN, destinationPoint, haversineMiles, preselectChains } from './geo.js';
import { zipCentroid } from './zip.js';

const at = (id: number, bearing: number, miles: number) => ({
  id,
  ...destinationPoint(DEFAULT_ORIGIN, bearing, miles),
});

describe('destinationPoint', () => {
  it('lands exactly the requested distance away', () => {
    for (const [b, m] of [
      [0, 7],
      [90, 7],
      [215, 3.25],
      [300, 12],
    ] as const) {
      expect(haversineMiles(DEFAULT_ORIGIN, destinationPoint(DEFAULT_ORIGIN, b, m))).toBeCloseTo(
        m,
        9,
      );
    }
  });
});

describe('preselectChains (SPEC §2.7)', () => {
  it('includes a chain exactly 7.0 mi away and excludes one at 7.01 mi', () => {
    const r = preselectChains(DEFAULT_ORIGIN, [
      { storeId: 1, locations: [at(10, 45, 7.0)] },
      { storeId: 2, locations: [at(20, 90, 7.01)] },
    ]);
    expect(r.fallback).toBe(false);
    expect(r.chains.map((c) => [c.storeId, c.preselected])).toEqual([
      [1, true],
      [2, false],
    ]);
  });

  it('uses each chain’s nearest location', () => {
    const r = preselectChains(DEFAULT_ORIGIN, [
      { storeId: 1, locations: [at(10, 0, 20), at(11, 180, 2.5), at(12, 90, 9)] },
    ]);
    expect(r.chains[0]).toMatchObject({ nearestLocationId: 11, preselected: true });
    expect(r.chains[0]?.distanceMiles).toBeCloseTo(2.5, 9);
  });

  it('falls back to the 3 nearest chains when none is within range', () => {
    const r = preselectChains(DEFAULT_ORIGIN, [
      { storeId: 1, locations: [at(1, 0, 30)] },
      { storeId: 2, locations: [at(2, 0, 10)] },
      { storeId: 3, locations: [at(3, 0, 50)] },
      { storeId: 4, locations: [at(4, 0, 12)] },
      { storeId: 5, locations: [at(5, 0, 8)] },
      { storeId: 6, locations: [] },
    ]);
    expect(r.fallback).toBe(true);
    expect(r.chains.filter((c) => c.preselected).map((c) => c.storeId)).toEqual([2, 4, 5]);
    expect(r.chains.find((c) => c.storeId === 6)).toMatchObject({
      distanceMiles: null,
      preselected: false,
    });
  });
});

describe('zipCentroid', () => {
  it('knows DFW ZIPs and rejects others', () => {
    const frisco = zipCentroid('75034');
    expect(frisco).not.toBeNull();
    expect(haversineMiles(DEFAULT_ORIGIN, frisco ?? DEFAULT_ORIGIN)).toBeLessThan(3);
    expect(zipCentroid('10001')).toBeNull(); // New York
    expect(zipCentroid('7503')).toBeNull();
    expect(zipCentroid('abcde')).toBeNull();
  });
});
