import type { UnitCode } from '@sgs/core';
import type { FixtureLine } from './family-fixture.js';

export interface TemplateSpec {
  readonly name: string;
  readonly description: string;
  readonly items: readonly FixtureLine[];
}

const L = (product: string, quantity = 1, unit: UnitCode | null = null): FixtureLine => ({
  product,
  quantity,
  unit,
});

/** System templates (user_id NULL, read-only, shared by everyone) — SPEC Phase 3. */
export const SYSTEM_TEMPLATES: readonly TemplateSpec[] = [
  {
    name: 'Weekly staples',
    description: 'The basics most families buy every week.',
    items: [
      L('whole-milk', 1, 'gal'),
      L('large-eggs', 12, 'ea'),
      L('white-bread'),
      L('bananas', 2, 'lb'),
      L('chicken-breast', 2, 'lb'),
      L('ground-beef-80', 1, 'lb'),
      L('shredded-cheddar'),
      L('russet-potatoes'),
      L('yellow-onions'),
      L('roma-tomatoes', 1, 'lb'),
      L('toasted-oats-cereal'),
      L('orange-juice'),
    ],
  },
  {
    name: 'Taco night',
    description: 'Tacos for a family of four.',
    items: [
      L('ground-beef-80', 2, 'lb'),
      L('flour-tortillas'),
      L('corn-tortillas'),
      L('shredded-cheddar'),
      L('salsa'),
      L('avocados', 3, 'ea'),
      L('roma-tomatoes', 1, 'lb'),
      L('sour-cream'),
      L('jalapenos', 0.25, 'lb'),
      L('cilantro'),
      L('limes', 4, 'ea'),
      L('refried-beans'),
    ],
  },
  {
    name: 'Breakfast',
    description: 'A week of family breakfasts.',
    items: [
      L('large-eggs', 12, 'ea'),
      L('bacon'),
      L('breakfast-sausage'),
      L('pancake-mix'),
      L('pancake-syrup'),
      L('orange-juice'),
      L('ground-coffee'),
      L('half-and-half'),
      L('bagels'),
      L('strawberries'),
    ],
  },
  {
    name: 'Kid lunches',
    description: 'School lunches for the week.',
    items: [
      L('white-bread', 2),
      L('peanut-butter'),
      L('grape-jelly'),
      L('deli-turkey'),
      L('american-singles'),
      L('string-cheese'),
      L('granola-bars'),
      L('fruit-snacks'),
      L('baby-carrots'),
      L('gala-apples', 2, 'lb'),
    ],
  },
  {
    name: 'Holiday baking',
    description: 'Cookies, pies and more for the holidays.',
    items: [
      L('all-purpose-flour'),
      L('granulated-sugar'),
      L('brown-sugar'),
      L('powdered-sugar'),
      L('salted-butter', 2),
      L('large-eggs', 12, 'ea'),
      L('vanilla-extract'),
      L('chocolate-chips', 2),
      L('baking-soda'),
      L('baking-powder'),
      L('ground-cinnamon'),
      L('canned-pumpkin', 2),
      L('pecans'),
      L('evaporated-milk'),
    ],
  },
];
