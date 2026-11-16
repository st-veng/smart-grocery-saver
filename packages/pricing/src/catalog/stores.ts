/**
 * Mock chain configuration: calibration (SPEC §2.6), promo behaviour and DFW mock locations.
 * Locations are approximate suburb coordinates labelled "(mock)" — not real store addresses (A-11).
 */
import type { AisleSlug } from './categories.js';

export type StoreSlug =
  | 'walmart'
  | 'costco'
  | 'sams'
  | 'target'
  | 'kroger'
  | 'heb'
  | 'aldi'
  | 'tomthumb'
  | 'sprouts'
  | 'traderjoes';

export interface PromoProfile {
  /** weekly: ad weeks starting on `startDow`; monthly: calendar months; block: N-day blocks (rollbacks). */
  readonly cadence: 'weekly' | 'monthly' | 'block';
  readonly startDow?: number;
  /** Ad length in days; 8 = Wednesday overlap (Sprouts). */
  readonly adDays?: number;
  readonly blockDays?: number;
  readonly pItem: number | ((category: AisleSlug) => number);
  readonly depth: readonly [number, number];
  /** Share of promos that are member-only (paid membership or loyalty card). */
  readonly memberShare: number;
  readonly multiBuyShare: number;
  readonly label: string;
  readonly memberLabel?: string;
}

export interface ChainSpec {
  readonly slug: StoreSlug;
  readonly name: string;
  readonly brandColor: string;
  readonly sortOrder: number;
  readonly requiresMembership: boolean;
  readonly membershipFeeCents: number | null;
  readonly loyaltyProgram: string | null;
  /** Per-unit regular price index vs Kroger (midpoint of SPEC §2.6 range). */
  readonly index: (category: AisleSlug) => number;
  readonly coverage: (category: AisleSlug) => number;
  readonly storeBrands: readonly string[];
  /** Probability the chain also carries a national-brand item for a product. */
  readonly nationalShare: number;
  /** Probability a second store-brand size is carried (non-club chains). */
  readonly secondSizeShare: number;
  readonly bulkOnly: boolean;
  readonly storeBrandOnly: boolean;
  readonly promo: PromoProfile | null;
  readonly titleStyle: 0 | 1 | 2 | 3;
  readonly locations: readonly LocationSpec[];
}

export interface LocationSpec {
  readonly city: string;
  readonly zip: string;
  readonly lat: number;
  readonly lng: number;
}

const flat = (n: number) => () => n;
const PRODUCE_LIKE: readonly AisleSlug[] = ['produce'];

// Suburb anchor points (approximate). Main St & Preston Rd, Frisco ≈ 33.1500, -96.8065.
const LOC = {
  friscoWest: { city: 'Frisco', zip: '75034', lat: 33.1507, lng: -96.8236 },
  friscoEast: { city: 'Frisco', zip: '75035', lat: 33.1545, lng: -96.7645 },
  friscoNorth: { city: 'Frisco', zip: '75033', lat: 33.1985, lng: -96.8125 },
  friscoStonebriar: { city: 'Frisco', zip: '75034', lat: 33.1012, lng: -96.8112 },
  prosper: { city: 'Prosper', zip: '75078', lat: 33.2362, lng: -96.8011 },
  theColony: { city: 'The Colony', zip: '75056', lat: 33.0901, lng: -96.8864 },
  planoNorth: { city: 'Plano', zip: '75024', lat: 33.0801, lng: -96.7541 },
  planoWest: { city: 'Plano', zip: '75093', lat: 33.0324, lng: -96.8073 },
  planoEast: { city: 'Plano', zip: '75074', lat: 33.0198, lng: -96.6987 },
  mckinney: { city: 'McKinney', zip: '75070', lat: 33.1972, lng: -96.6398 },
  allen: { city: 'Allen', zip: '75013', lat: 33.1032, lng: -96.6706 },
  littleElm: { city: 'Little Elm', zip: '75068', lat: 33.1626, lng: -96.9375 },
  lewisville: { city: 'Lewisville', zip: '75067', lat: 33.0462, lng: -96.9942 },
  carrollton: { city: 'Carrollton', zip: '75007', lat: 32.9756, lng: -96.8899 },
  richardson: { city: 'Richardson', zip: '75080', lat: 32.9483, lng: -96.7299 },
  dallas: { city: 'Dallas', zip: '75225', lat: 32.8668, lng: -96.7731 },
  southlake: { city: 'Southlake', zip: '76092', lat: 32.9412, lng: -97.1342 },
  fortWorth: { city: 'Fort Worth', zip: '76109', lat: 32.7065, lng: -97.3801 },
  arlington: { city: 'Arlington', zip: '76015', lat: 32.6943, lng: -97.118 },
  denton: { city: 'Denton', zip: '76201', lat: 33.2148, lng: -97.1331 },
} as const satisfies Record<string, LocationSpec>;

export const CHAINS: readonly ChainSpec[] = [
  {
    slug: 'walmart',
    name: 'Walmart',
    brandColor: '#0071CE',
    sortOrder: 1,
    requiresMembership: false,
    membershipFeeCents: null,
    loyaltyProgram: null,
    index: flat(0.88),
    coverage: flat(0.98),
    storeBrands: ['Great Value', "Sam's Choice"],
    nationalShare: 0.45,
    secondSizeShare: 0.35,
    bulkOnly: false,
    storeBrandOnly: false,
    promo: {
      cadence: 'block',
      blockDays: 28,
      pItem: 0.05,
      depth: [0.1, 0.2],
      memberShare: 0,
      multiBuyShare: 0,
      label: 'Rollback',
    },
    titleStyle: 0,
    locations: [LOC.friscoWest, LOC.planoNorth, LOC.mckinney, LOC.lewisville],
  },
  {
    slug: 'costco',
    name: 'Costco',
    brandColor: '#E31837',
    sortOrder: 2,
    requiresMembership: true,
    membershipFeeCents: 6500,
    loyaltyProgram: null,
    index: flat(0.81),
    coverage: flat(0.85),
    storeBrands: ['Kirkland Signature'],
    nationalShare: 0.35,
    secondSizeShare: 0,
    bulkOnly: true,
    storeBrandOnly: false,
    promo: {
      cadence: 'monthly',
      pItem: 0.08,
      depth: [0.15, 0.25],
      memberShare: 1,
      multiBuyShare: 0,
      label: 'Member savings',
      memberLabel: 'Member savings',
    },
    titleStyle: 3,
    locations: [LOC.friscoEast, LOC.planoWest, LOC.mckinney, LOC.southlake],
  },
  {
    slug: 'sams',
    name: "Sam's Club",
    brandColor: '#0067A0',
    sortOrder: 3,
    requiresMembership: true,
    membershipFeeCents: 5000,
    loyaltyProgram: null,
    index: flat(0.83),
    coverage: flat(0.85),
    storeBrands: ["Member's Mark"],
    nationalShare: 0.35,
    secondSizeShare: 0,
    bulkOnly: true,
    storeBrandOnly: false,
    promo: {
      cadence: 'monthly',
      pItem: 0.08,
      depth: [0.12, 0.22],
      memberShare: 1,
      multiBuyShare: 0,
      label: 'Instant Savings',
      memberLabel: 'Instant Savings',
    },
    titleStyle: 3,
    locations: [LOC.friscoStonebriar, LOC.planoEast, LOC.lewisville, LOC.fortWorth],
  },
  {
    slug: 'target',
    name: 'Target',
    brandColor: '#CC0000',
    sortOrder: 4,
    requiresMembership: false,
    membershipFeeCents: null,
    loyaltyProgram: null,
    index: flat(1.055),
    coverage: flat(0.85),
    storeBrands: ['Good & Gather', 'Market Pantry', 'up&up'],
    nationalShare: 0.45,
    secondSizeShare: 0.25,
    bulkOnly: false,
    storeBrandOnly: false,
    promo: {
      cadence: 'weekly',
      startDow: 0,
      pItem: 0.08,
      depth: [0.15, 0.25],
      memberShare: 0,
      multiBuyShare: 0.15,
      label: 'Circle deal',
    },
    titleStyle: 2,
    locations: [LOC.friscoNorth, LOC.planoWest, LOC.allen, LOC.dallas],
  },
  {
    slug: 'kroger',
    name: 'Kroger',
    brandColor: '#0D4C9C',
    sortOrder: 5,
    requiresMembership: false,
    membershipFeeCents: null,
    loyaltyProgram: 'Kroger Plus Card',
    index: flat(1),
    coverage: flat(0.95),
    storeBrands: ['Kroger', 'Simple Truth'],
    nationalShare: 0.45,
    secondSizeShare: 0.3,
    bulkOnly: false,
    storeBrandOnly: false,
    promo: {
      cadence: 'weekly',
      startDow: 3,
      pItem: 0.12,
      depth: [0.2, 0.35],
      memberShare: 0.8,
      multiBuyShare: 0.1,
      label: 'Weekly ad',
      memberLabel: 'Card price',
    },
    titleStyle: 1,
    locations: [LOC.friscoWest, LOC.prosper, LOC.planoNorth, LOC.richardson],
  },
  {
    slug: 'heb',
    name: 'H-E-B',
    brandColor: '#DC291E',
    sortOrder: 6,
    requiresMembership: false,
    membershipFeeCents: null,
    loyaltyProgram: null,
    index: flat(0.925),
    coverage: flat(0.92),
    storeBrands: ['H-E-B', 'Hill Country Fare'],
    nationalShare: 0.4,
    secondSizeShare: 0.3,
    bulkOnly: false,
    storeBrandOnly: false,
    promo: {
      cadence: 'weekly',
      startDow: 3,
      pItem: 0.1,
      depth: [0.1, 0.25],
      memberShare: 0,
      multiBuyShare: 0.05,
      label: 'Weekly ad',
    },
    titleStyle: 3,
    locations: [LOC.friscoNorth, LOC.planoEast, LOC.mckinney, LOC.allen],
  },
  {
    slug: 'aldi',
    name: 'Aldi',
    brandColor: '#00005F',
    sortOrder: 7,
    requiresMembership: false,
    membershipFeeCents: null,
    loyaltyProgram: null,
    index: flat(0.825),
    coverage: flat(0.7),
    storeBrands: ['Friendly Farms', 'Simply Nature', 'Millville', 'Clancy’s', 'Specially Selected'],
    nationalShare: 0.1,
    secondSizeShare: 0.1,
    bulkOnly: false,
    storeBrandOnly: false,
    promo: {
      cadence: 'weekly',
      startDow: 3,
      pItem: 0.02,
      depth: [0.1, 0.2],
      memberShare: 0,
      multiBuyShare: 0,
      label: 'Weekly ad',
    },
    titleStyle: 0,
    locations: [LOC.friscoEast, LOC.theColony, LOC.planoEast, LOC.carrollton],
  },
  {
    slug: 'tomthumb',
    name: 'Tom Thumb',
    brandColor: '#E21A2C',
    sortOrder: 8,
    requiresMembership: false,
    membershipFeeCents: null,
    loyaltyProgram: 'Tom Thumb for U',
    index: flat(1.1),
    coverage: flat(0.93),
    storeBrands: ['Signature SELECT', 'O Organics', 'Lucerne'],
    nationalShare: 0.5,
    secondSizeShare: 0.25,
    bulkOnly: false,
    storeBrandOnly: false,
    promo: {
      cadence: 'weekly',
      startDow: 3,
      pItem: 0.2,
      depth: [0.25, 0.4],
      memberShare: 0.9,
      multiBuyShare: 0.1,
      label: 'Weekly ad',
      memberLabel: 'for U price',
    },
    titleStyle: 1,
    locations: [LOC.friscoStonebriar, LOC.prosper, LOC.planoWest, LOC.dallas],
  },
  {
    slug: 'sprouts',
    name: 'Sprouts Farmers Market',
    brandColor: '#5A8E22',
    sortOrder: 9,
    requiresMembership: false,
    membershipFeeCents: null,
    loyaltyProgram: null,
    index: (c) => (PRODUCE_LIKE.includes(c) ? 0.91 : 1.07),
    coverage: (c) => (PRODUCE_LIKE.includes(c) ? 0.97 : 0.55),
    storeBrands: ['Sprouts'],
    nationalShare: 0.35,
    secondSizeShare: 0.1,
    bulkOnly: false,
    storeBrandOnly: false,
    promo: {
      cadence: 'weekly',
      startDow: 3,
      adDays: 8,
      pItem: (c) => (PRODUCE_LIKE.includes(c) ? 0.2 : 0.08),
      depth: [0.2, 0.4],
      memberShare: 0,
      multiBuyShare: 0.05,
      label: 'Weekly ad',
    },
    titleStyle: 2,
    locations: [LOC.friscoWest, LOC.theColony, LOC.planoNorth, LOC.mckinney],
  },
  {
    slug: 'traderjoes',
    name: "Trader Joe's",
    brandColor: '#BA0C2F',
    sortOrder: 10,
    requiresMembership: false,
    membershipFeeCents: null,
    loyaltyProgram: null,
    index: flat(0.925),
    coverage: flat(0.4),
    storeBrands: ["Trader Joe's"],
    nationalShare: 0,
    secondSizeShare: 0,
    bulkOnly: false,
    storeBrandOnly: true,
    promo: null,
    titleStyle: 0,
    // Nearest location is deliberately beyond 7 mi of the Frisco reference point (SPEC §2.7).
    locations: [LOC.planoEast, LOC.dallas, LOC.southlake, LOC.denton],
  },
];

/** Chains that staple products are forced into. */
export const MAINSTREAM: readonly StoreSlug[] = ['walmart', 'kroger', 'target', 'heb', 'tomthumb'];
/** Order used to top a product up to ≥4 chains. */
export const TOP_UP_ORDER: readonly StoreSlug[] = [
  'walmart',
  'kroger',
  'heb',
  'tomthumb',
  'target',
];

export function chainBySlug(slug: string): ChainSpec {
  const c = CHAINS.find((x) => x.slug === slug);
  if (!c) throw new Error(`Unknown chain ${slug}`);
  return c;
}
