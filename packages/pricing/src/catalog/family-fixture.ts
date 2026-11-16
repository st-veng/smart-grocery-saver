import type { UnitCode } from '@sgs/core';

/** "Typical DFW family week" — 35 items used for calibration (SPEC §2.6) and later golden tests. */
export interface FixtureLine {
  readonly product: string;
  readonly quantity: number;
  /** null → quantity × the product's default package. */
  readonly unit: UnitCode | null;
}

export const FAMILY_WEEK: readonly FixtureLine[] = [
  { product: 'whole-milk', quantity: 2, unit: 'gal' },
  { product: 'large-eggs', quantity: 18, unit: 'ea' },
  { product: 'bananas', quantity: 3, unit: 'lb' },
  { product: 'gala-apples', quantity: 3, unit: 'lb' },
  { product: 'strawberries', quantity: 1, unit: null },
  { product: 'avocados', quantity: 4, unit: 'ea' },
  { product: 'roma-tomatoes', quantity: 2, unit: 'lb' },
  { product: 'yellow-onions', quantity: 1, unit: null },
  { product: 'russet-potatoes', quantity: 5, unit: 'lb' },
  { product: 'romaine', quantity: 1, unit: null },
  { product: 'ground-beef-80', quantity: 3, unit: 'lb' },
  { product: 'chicken-breast', quantity: 4, unit: 'lb' },
  { product: 'bacon', quantity: 1, unit: null },
  { product: 'salted-butter', quantity: 1, unit: null },
  { product: 'shredded-cheddar', quantity: 16, unit: 'oz' },
  { product: 'white-bread', quantity: 2, unit: null },
  { product: 'flour-tortillas', quantity: 20, unit: 'ea' },
  { product: 'peanut-butter', quantity: 1, unit: null },
  { product: 'diced-tomatoes', quantity: 2, unit: null },
  { product: 'salsa', quantity: 1, unit: null },
  { product: 'mac-and-cheese', quantity: 3, unit: null },
  { product: 'ketchup', quantity: 1, unit: null },
  { product: 'spaghetti', quantity: 2, unit: null },
  { product: 'pasta-sauce', quantity: 2, unit: null },
  { product: 'white-rice', quantity: 2, unit: 'lb' },
  { product: 'toasted-oats-cereal', quantity: 1, unit: null },
  { product: 'ground-coffee', quantity: 1, unit: null },
  { product: 'orange-juice', quantity: 1, unit: null },
  { product: 'bottled-water', quantity: 1, unit: null },
  { product: 'cola', quantity: 1, unit: null },
  { product: 'tortilla-chips', quantity: 1, unit: null },
  { product: 'granola-bars', quantity: 1, unit: null },
  { product: 'toilet-paper', quantity: 1, unit: null },
  { product: 'frozen-mixed-veg', quantity: 2, unit: null },
  { product: 'vanilla-ice-cream', quantity: 1, unit: null },
];
