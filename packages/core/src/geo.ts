export interface LatLng {
  readonly lat: number;
  readonly lng: number;
}

/**
 * Main St & Preston Rd, Frisco TX — default origin, demo user and e2e fixture home (SPEC §2.7).
 * Estimated from nearby Preston Rd address geocodes (8555 Preston Rd ≈ 33.1473, -96.8075).
 */
export const DEFAULT_ORIGIN: LatLng = { lat: 33.15, lng: -96.8065 };
export const PRESELECT_RADIUS_MILES = 7;
/** Straight-line → road distance multiplier for route cost (SPEC A-9). Not used for pre-selection. */
export const CIRCUITY_FACTOR = 1.25;

const EARTH_RADIUS_MILES = 3958.7613;

export function haversineMiles(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function parseLatLng(text: string): LatLng {
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(text);
  if (!m?.[1] || !m[2]) throw new RangeError(`Invalid "lat,lng": ${text}`);
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    throw new RangeError(`Out of range "lat,lng": ${text}`);
  }
  return { lat, lng };
}

/** Point `miles` away from `origin` along `bearingDeg` (great-circle). Used to build exact-distance fixtures. */
export function destinationPoint(origin: LatLng, bearingDeg: number, miles: number): LatLng {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;
  const δ = miles / EARTH_RADIUS_MILES;
  const θ = toRad(bearingDeg);
  const φ1 = toRad(origin.lat);
  const λ1 = toRad(origin.lng);
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
  const λ2 =
    λ1 +
    Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));
  return { lat: toDeg(φ2), lng: toDeg(λ2) };
}

export interface ChainLocations {
  readonly storeId: number;
  readonly locations: readonly (LatLng & { readonly id: number })[];
}

export interface ChainDistance {
  readonly storeId: number;
  readonly nearestLocationId: number | null;
  /** Straight-line miles to the nearest location (no circuity factor), or null with no locations. */
  readonly distanceMiles: number | null;
  readonly preselected: boolean;
}

/**
 * Onboarding pre-selection (SPEC §2.7): a chain is pre-selected when its nearest location is within
 * `radiusMiles` (inclusive) straight-line of `origin`. If none qualifies, the `fallbackCount` nearest
 * chains are pre-selected instead and `fallback` is true.
 */
export function preselectChains(
  origin: LatLng,
  chains: readonly ChainLocations[],
  radiusMiles: number = PRESELECT_RADIUS_MILES,
  fallbackCount = 3,
): { chains: ChainDistance[]; fallback: boolean } {
  const measured = chains.map((c) => {
    let best: { id: number; d: number } | null = null;
    for (const l of c.locations) {
      const d = haversineMiles(origin, l);
      if (best === null || d < best.d) best = { id: l.id, d };
    }
    return {
      storeId: c.storeId,
      nearestLocationId: best?.id ?? null,
      distanceMiles: best?.d ?? null,
    };
  });
  const within = new Set(
    measured
      .filter((m) => m.distanceMiles !== null && m.distanceMiles <= radiusMiles + 1e-9)
      .map((m) => m.storeId),
  );
  const fallback = within.size === 0;
  if (fallback) {
    measured
      .filter((m) => m.distanceMiles !== null)
      .sort((a, b) => (a.distanceMiles ?? 0) - (b.distanceMiles ?? 0) || a.storeId - b.storeId)
      .slice(0, fallbackCount)
      .forEach((m) => within.add(m.storeId));
  }
  return { chains: measured.map((m) => ({ ...m, preselected: within.has(m.storeId) })), fallback };
}
