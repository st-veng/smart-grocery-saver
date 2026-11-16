import { DFW_ZIP_CENTROIDS } from './data/dfw-zips.js';
import type { LatLng } from './geo.js';

/** Centroid of a DFW ZIP (SPEC A-8), or null when the ZIP is outside the launch metro or unknown. */
export function zipCentroid(zip: string): LatLng | null {
  if (!/^\d{5}$/.test(zip)) return null;
  const c = DFW_ZIP_CENTROIDS[zip];
  return c ? { lat: c[0], lng: c[1] } : null;
}
