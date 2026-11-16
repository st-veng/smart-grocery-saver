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
