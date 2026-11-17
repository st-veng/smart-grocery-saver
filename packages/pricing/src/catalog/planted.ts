/**
 * Planted price events (SPEC Phase 5): deterministic days after the seed anchor where a product drops
 * to a clear 1-year low, so alerts can be demoed and tested with `pnpm sim:advance`. Dates are relative
 * to the anchor, so they work for any SEED_ANCHOR_DATE. Products here are deliberately not in any
 * template or fixture list.
 */
export interface PlantedLow {
  readonly product: string;
  readonly chain: string;
  /** First day of the event, in days after the anchor (1 = the first simulated day). */
  readonly offsetDays: number;
  readonly days: number;
  /** Clearance price = regular × factor. */
  readonly factor: number;
  readonly label: string;
}

export const PLANTED_LOWS: readonly PlantedLow[] = [
  { product: 'honey', chain: 'walmart', offsetDays: 1, days: 3, factor: 0.5, label: 'Clearance' },
];
