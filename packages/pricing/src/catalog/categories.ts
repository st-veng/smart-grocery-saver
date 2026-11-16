/** Two-level category tree: 4 departments → 14 aisles (SPEC §4, ~14 categories). */
export interface CategorySpec {
  readonly slug: string;
  readonly name: string;
  readonly icon: string;
  readonly parent: string | null;
}

export const DEPARTMENTS: readonly CategorySpec[] = [
  { slug: 'fresh', name: 'Fresh', icon: 'leaf', parent: null },
  { slug: 'pantry-dept', name: 'Pantry', icon: 'archive', parent: null },
  { slug: 'drinks-frozen', name: 'Drinks & Frozen', icon: 'snowflake', parent: null },
  { slug: 'home', name: 'Household', icon: 'home', parent: null },
];

export const AISLES = [
  { slug: 'produce', name: 'Produce', icon: 'apple', parent: 'fresh' },
  { slug: 'dairy', name: 'Dairy', icon: 'milk', parent: 'fresh' },
  { slug: 'eggs', name: 'Eggs', icon: 'egg', parent: 'fresh' },
  { slug: 'meat', name: 'Meat', icon: 'beef', parent: 'fresh' },
  { slug: 'seafood', name: 'Seafood', icon: 'fish', parent: 'fresh' },
  { slug: 'bakery', name: 'Bakery & Tortillas', icon: 'croissant', parent: 'fresh' },
  { slug: 'pantry', name: 'Canned & Condiments', icon: 'jar', parent: 'pantry-dept' },
  { slug: 'pasta-grains', name: 'Pasta, Rice & Grains', icon: 'wheat', parent: 'pantry-dept' },
  { slug: 'breakfast', name: 'Breakfast & Cereal', icon: 'coffee', parent: 'pantry-dept' },
  { slug: 'snacks', name: 'Snacks', icon: 'cookie', parent: 'pantry-dept' },
  { slug: 'baking', name: 'Baking & Spices', icon: 'cake', parent: 'pantry-dept' },
  { slug: 'beverages', name: 'Beverages', icon: 'cup', parent: 'drinks-frozen' },
  { slug: 'frozen', name: 'Frozen', icon: 'snowflake', parent: 'drinks-frozen' },
  { slug: 'household', name: 'Household & Baby', icon: 'spray', parent: 'home' },
] as const satisfies readonly CategorySpec[];

export type AisleSlug = (typeof AISLES)[number]['slug'];
