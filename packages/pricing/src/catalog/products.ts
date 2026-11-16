/**
 * Canonical product catalog (brand-agnostic comparable items). This is OUR data, not provider data.
 * `ref` is the Kroger store-brand regular price in cents for `sizes[0]` (or per lb when byWeight),
 * at the seed anchor date. All prices are mock.
 */
import type { Dimension, UnitCode } from '@sgs/core';
import type { AisleSlug } from './categories.js';

export type PromoTheme = 'turkey' | 'baking' | 'grilling';

export interface ProductSpec {
  readonly slug: string;
  readonly name: string;
  readonly category: AisleSlug;
  /** Retail sizes; first is the reference package. byWeight products use 'per lb'. */
  readonly sizes: readonly string[];
  readonly ref: number;
  /** Warehouse-club package; clubs carry the product only if this is set (or it is sold by weight). */
  readonly bulk?: string;
  readonly byWeight?: boolean;
  readonly brands?: readonly string[];
  readonly aliases?: readonly string[];
  /** Forced coverage at mainstream chains (Walmart, Kroger, Target, H-E-B, Tom Thumb). */
  readonly staple?: boolean;
  /** [cheapest month 1–12, amplitude 0–1] seasonal regular-price swing. */
  readonly season?: readonly [number, number];
  readonly avgEach?: number;
  readonly promo?: PromoTheme;
  readonly eggShock?: boolean;
  readonly dim?: Dimension;
  readonly disp?: UnitCode;
  readonly attrs?: Readonly<Record<string, string | boolean>>;
}

type Opts = Omit<ProductSpec, 'slug' | 'name' | 'category' | 'sizes' | 'ref'>;
const p = (
  slug: string,
  name: string,
  category: AisleSlug,
  sizes: string | readonly string[],
  ref: number,
  opts: Opts = {},
): ProductSpec => ({
  slug,
  name,
  category,
  sizes: typeof sizes === 'string' ? [sizes] : sizes,
  ref,
  ...opts,
});

const W = { byWeight: true } as const;

export const PRODUCTS: readonly ProductSpec[] = [
  // ───────── Produce ─────────
  p('bananas', 'Bananas', 'produce', 'per lb', 59, {
    ...W,
    bulk: '3 lb',
    avgEach: 118,
    staple: true,
    aliases: ['banana'],
  }),
  p('gala-apples', 'Gala Apples', 'produce', 'per lb', 179, {
    ...W,
    bulk: '5 lb',
    avgEach: 180,
    season: [10, 0.15],
    aliases: ['gala apple', 'apples'],
  }),
  p('honeycrisp-apples', 'Honeycrisp Apples', 'produce', 'per lb', 249, {
    ...W,
    bulk: '5 lb',
    avgEach: 220,
    season: [10, 0.2],
  }),
  p('navel-oranges', 'Navel Oranges', 'produce', 'per lb', 149, {
    ...W,
    bulk: '8 lb',
    avgEach: 200,
    season: [1, 0.25],
    aliases: ['oranges', 'orange'],
  }),
  p('lemons', 'Lemons', 'produce', '1 each', 69, {
    bulk: '2 lb',
    avgEach: 100,
    aliases: ['lemon'],
  }),
  p('limes', 'Limes', 'produce', '1 each', 33, { bulk: '3 lb', avgEach: 67, aliases: ['lime'] }),
  p('avocados', 'Hass Avocados', 'produce', '1 each', 125, {
    bulk: '6 ct',
    avgEach: 200,
    season: [5, 0.2],
    staple: true,
    aliases: ['avocado', 'avocados'],
  }),
  p('strawberries', 'Strawberries', 'produce', '16 oz', 349, {
    bulk: '2 lb',
    season: [5, 0.3],
    staple: true,
    aliases: ['strawberry'],
  }),
  p('blueberries', 'Blueberries', 'produce', ['18 oz', '6 oz'], 499, {
    bulk: '2 lb',
    season: [7, 0.3],
    aliases: ['blueberry'],
  }),
  p('raspberries', 'Raspberries', 'produce', '6 oz', 399, { bulk: '18 oz', season: [7, 0.3] }),
  p('red-grapes', 'Red Seedless Grapes', 'produce', 'per lb', 249, {
    ...W,
    bulk: '3 lb',
    season: [8, 0.25],
    aliases: ['grapes', 'red grapes'],
  }),
  p('watermelon', 'Seedless Watermelon', 'produce', '1 each', 499, {
    avgEach: 6800,
    season: [7, 0.35],
    aliases: ['watermelon'],
  }),
  p('pineapple', 'Pineapple', 'produce', '1 each', 249, { avgEach: 1600 }),
  p('roma-tomatoes', 'Roma Tomatoes', 'produce', 'per lb', 129, {
    ...W,
    bulk: '4 lb',
    avgEach: 85,
    season: [8, 0.25],
    staple: true,
    aliases: ['tomatoes', 'tomato'],
  }),
  p('russet-potatoes', 'Russet Potatoes', 'produce', ['5 lb', '10 lb'], 399, {
    bulk: '15 lb',
    staple: true,
    aliases: ['potatoes', 'potato'],
  }),
  p('sweet-potatoes', 'Sweet Potatoes', 'produce', 'per lb', 129, {
    ...W,
    bulk: '6 lb',
    season: [11, 0.2],
    aliases: ['yams', 'sweet potato'],
  }),
  p('yellow-onions', 'Yellow Onions', 'produce', '3 lb', 349, {
    bulk: '10 lb',
    staple: true,
    aliases: ['onions', 'onion'],
  }),
  p('carrots', 'Carrots', 'produce', ['2 lb', '1 lb'], 199, { bulk: '10 lb', aliases: ['carrot'] }),
  p('baby-carrots', 'Baby Carrots', 'produce', '1 lb', 149, { bulk: '5 lb' }),
  p('broccoli', 'Broccoli Crowns', 'produce', 'per lb', 199, {
    ...W,
    bulk: '3 lb',
    season: [10, 0.15],
    aliases: ['broccoli'],
  }),
  p('cauliflower', 'Cauliflower', 'produce', '1 each', 349, { avgEach: 840 }),
  p('romaine', 'Romaine Hearts', 'produce', '3 ct', 399, {
    bulk: '6 ct',
    aliases: ['romaine lettuce', 'lettuce'],
  }),
  p('baby-spinach', 'Baby Spinach', 'produce', ['5 oz', '10 oz'], 299, {
    bulk: '1 lb',
    aliases: ['spinach'],
  }),
  p('spring-mix', 'Spring Mix Salad', 'produce', '5 oz', 349, {
    bulk: '1 lb',
    aliases: ['salad mix', 'mixed greens'],
  }),
  p('cucumbers', 'Cucumbers', 'produce', '1 each', 79, {
    avgEach: 300,
    season: [7, 0.2],
    aliases: ['cucumber'],
  }),
  p('green-bell-peppers', 'Green Bell Peppers', 'produce', '1 each', 99, {
    avgEach: 170,
    bulk: '6 ct',
    aliases: ['green pepper', 'bell pepper'],
  }),
  p('red-bell-peppers', 'Red Bell Peppers', 'produce', '1 each', 149, {
    avgEach: 170,
    bulk: '6 ct',
    aliases: ['red pepper'],
  }),
  p('celery', 'Celery', 'produce', '1 each', 199, { avgEach: 700 }),
  p('white-mushrooms', 'White Mushrooms', 'produce', '8 oz', 229, {
    bulk: '24 oz',
    aliases: ['mushrooms'],
  }),
  p('garlic', 'Garlic', 'produce', '1 each', 69, {
    avgEach: 50,
    bulk: '2 lb',
    aliases: ['garlic bulb'],
  }),
  p('cilantro', 'Cilantro', 'produce', '1 each', 79, { avgEach: 60 }),
  p('sweet-corn', 'Sweet Corn', 'produce', '1 each', 50, {
    avgEach: 250,
    season: [7, 0.35],
    aliases: ['corn on the cob', 'corn'],
  }),
  p('green-beans', 'Fresh Green Beans', 'produce', 'per lb', 199, {
    ...W,
    bulk: '2 lb',
    season: [7, 0.2],
  }),
  p('zucchini', 'Zucchini', 'produce', 'per lb', 179, { ...W, season: [7, 0.25] }),
  p('jalapenos', 'Jalapeño Peppers', 'produce', 'per lb', 129, {
    ...W,
    aliases: ['jalapeno', 'jalapenos'],
  }),

  // ───────── Dairy ─────────
  p('whole-milk', 'Whole Milk', 'dairy', ['1 gal', '0.5 gal'], 389, {
    bulk: '2 x 1 gal',
    brands: ['Borden', 'Oak Farms'],
    staple: true,
    aliases: ['milk', 'vitamin d milk'],
    attrs: { fat: 'whole' },
  }),
  p('2-percent-milk', '2% Reduced Fat Milk', 'dairy', ['1 gal', '0.5 gal'], 379, {
    bulk: '2 x 1 gal',
    brands: ['Borden', 'Oak Farms'],
    staple: true,
    aliases: ['2% milk', 'reduced fat milk', 'two percent milk'],
    attrs: { fat: '2%' },
  }),
  p('skim-milk', 'Fat Free Skim Milk', 'dairy', '1 gal', 369, {
    brands: ['Borden'],
    aliases: ['skim milk', 'nonfat milk'],
    attrs: { fat: '0%' },
  }),
  p('organic-whole-milk', 'Organic Whole Milk', 'dairy', '0.5 gal', 499, {
    bulk: '3 x 0.5 gal',
    brands: ['Horizon Organic'],
    attrs: { organic: true, fat: 'whole' },
  }),
  p('almond-milk', 'Unsweetened Almond Milk', 'dairy', '64 fl oz', 299, {
    bulk: '3 x 64 fl oz',
    brands: ['Silk', 'Almond Breeze'],
    aliases: ['almond milk'],
  }),
  p('oat-milk', 'Oat Milk', 'dairy', '64 fl oz', 449, { brands: ['Oatly', 'Planet Oat'] }),
  p('heavy-cream', 'Heavy Whipping Cream', 'dairy', ['16 fl oz', '32 fl oz'], 349, {
    bulk: '64 fl oz',
    aliases: ['heavy cream', 'whipping cream'],
    promo: 'baking',
  }),
  p('half-and-half', 'Half & Half', 'dairy', '32 fl oz', 349, {
    bulk: '2 x 32 fl oz',
    aliases: ['half and half'],
  }),
  p('coffee-creamer', 'French Vanilla Coffee Creamer', 'dairy', '32 fl oz', 449, {
    brands: ['Coffee mate', 'International Delight'],
    aliases: ['creamer'],
  }),
  p('salted-butter', 'Salted Butter', 'dairy', '16 oz', 449, {
    bulk: '4 x 16 oz',
    brands: ['Land O Lakes'],
    staple: true,
    promo: 'baking',
    aliases: ['butter'],
  }),
  p('shredded-cheddar', 'Shredded Cheddar Cheese', 'dairy', ['8 oz', '16 oz'], 249, {
    bulk: '2.5 lb',
    brands: ['Kraft', 'Tillamook'],
    staple: true,
    aliases: ['shredded cheese', 'cheddar cheese'],
  }),
  p('shredded-mozzarella', 'Shredded Mozzarella Cheese', 'dairy', '8 oz', 249, {
    bulk: '2 x 2 lb',
    brands: ['Kraft'],
    aliases: ['mozzarella'],
  }),
  p('cheddar-block', 'Sharp Cheddar Cheese Block', 'dairy', '8 oz', 249, {
    bulk: '2 lb',
    brands: ['Tillamook', 'Cracker Barrel'],
  }),
  p('american-singles', 'American Cheese Singles', 'dairy', '16 oz', 399, {
    bulk: '2 x 16 oz',
    brands: ['Kraft'],
    aliases: ['american cheese', 'cheese slices'],
  }),
  p('cream-cheese', 'Cream Cheese', 'dairy', '8 oz', 229, {
    bulk: '6 x 8 oz',
    brands: ['Philadelphia'],
    promo: 'baking',
  }),
  p('sour-cream', 'Sour Cream', 'dairy', '16 oz', 229, { bulk: '48 oz', brands: ['Daisy'] }),
  p('greek-yogurt', 'Plain Greek Yogurt', 'dairy', ['32 oz', '5.3 oz'], 549, {
    bulk: '48 oz',
    brands: ['Chobani', 'Fage'],
    aliases: ['greek yogurt'],
  }),
  p('vanilla-yogurt', 'Vanilla Lowfat Yogurt', 'dairy', '32 oz', 349, {
    brands: ['Yoplait', 'Dannon'],
    aliases: ['yogurt'],
  }),
  p('cottage-cheese', 'Cottage Cheese', 'dairy', '24 oz', 399, { brands: ['Daisy'] }),
  p('parmesan', 'Grated Parmesan Cheese', 'dairy', '8 oz', 449, {
    bulk: '24 oz',
    brands: ['Kraft'],
    aliases: ['parmesan'],
  }),
  p('string-cheese', 'Mozzarella String Cheese', 'dairy', '12 x 1 oz', 499, {
    bulk: '48 x 1 oz',
    brands: ['Frigo'],
    aliases: ['string cheese'],
  }),

  // ───────── Eggs ─────────
  p('large-eggs', 'Large Grade A Eggs', 'eggs', ['12 ct', '18 ct'], 299, {
    bulk: '60 ct',
    brands: ["Eggland's Best"],
    staple: true,
    eggShock: true,
    aliases: ['eggs', 'dozen eggs', 'egg'],
  }),
  p('organic-eggs', 'Organic Large Brown Eggs', 'eggs', '12 ct', 549, {
    bulk: '24 ct',
    brands: ['Vital Farms'],
    eggShock: true,
    attrs: { organic: true },
  }),
  p('egg-whites', 'Liquid Egg Whites', 'eggs', '32 fl oz', 499, {
    bulk: '3 x 16 fl oz',
    brands: ['All Whites'],
  }),

  // ───────── Meat ─────────
  p('ground-beef-80', '80/20 Ground Beef', 'meat', 'per lb', 499, {
    ...W,
    staple: true,
    promo: 'grilling',
    aliases: ['ground beef', 'hamburger meat', '80/20 ground beef', 'beef'],
  }),
  p('ground-beef-93', '93/7 Lean Ground Beef', 'meat', 'per lb', 649, {
    ...W,
    aliases: ['lean ground beef'],
  }),
  p('chicken-breast', 'Boneless Skinless Chicken Breasts', 'meat', 'per lb', 349, {
    ...W,
    staple: true,
    aliases: ['chicken breast', 'chicken breasts', 'chicken'],
  }),
  p('chicken-thighs', 'Boneless Skinless Chicken Thighs', 'meat', 'per lb', 249, {
    ...W,
    aliases: ['chicken thighs'],
  }),
  p('whole-chicken', 'Whole Fryer Chicken', 'meat', 'per lb', 169, {
    ...W,
    aliases: ['whole chicken'],
  }),
  p('chicken-wings', 'Chicken Wings', 'meat', 'per lb', 399, {
    ...W,
    promo: 'grilling',
    aliases: ['wings'],
  }),
  p('pork-chops', 'Boneless Pork Chops', 'meat', 'per lb', 399, {
    ...W,
    promo: 'grilling',
    aliases: ['pork chops'],
  }),
  p('pork-shoulder', 'Pork Shoulder Roast', 'meat', 'per lb', 229, {
    ...W,
    aliases: ['pork butt'],
  }),
  p('ribeye-steak', 'Ribeye Steak', 'meat', 'per lb', 1399, {
    ...W,
    promo: 'grilling',
    aliases: ['ribeye'],
  }),
  p('sirloin-steak', 'Top Sirloin Steak', 'meat', 'per lb', 899, {
    ...W,
    promo: 'grilling',
    aliases: ['sirloin'],
  }),
  p('brisket', 'Beef Brisket', 'meat', 'per lb', 499, { ...W, promo: 'grilling' }),
  p('whole-turkey', 'Frozen Whole Turkey', 'meat', 'per lb', 149, {
    ...W,
    promo: 'turkey',
    aliases: ['turkey', 'thanksgiving turkey'],
  }),
  p('bacon', 'Hickory Smoked Bacon', 'meat', '16 oz', 599, {
    bulk: '3 x 16 oz',
    brands: ['Oscar Mayer', 'Wright'],
    staple: true,
    aliases: ['bacon'],
  }),
  p('breakfast-sausage', 'Pork Breakfast Sausage', 'meat', '16 oz', 399, {
    bulk: '3 x 16 oz',
    brands: ['Jimmy Dean'],
    aliases: ['sausage'],
  }),
  p('hot-dogs', 'Beef Hot Dogs', 'meat', '12 oz', 349, {
    bulk: '4 x 12 oz',
    brands: ['Oscar Mayer', 'Hebrew National'],
    promo: 'grilling',
    aliases: ['franks', 'hot dog'],
  }),
  p('smoked-sausage', 'Smoked Sausage', 'meat', '14 oz', 349, {
    bulk: '3 x 14 oz',
    brands: ['Hillshire Farm'],
    promo: 'grilling',
  }),
  p('ground-turkey', 'Ground Turkey', 'meat', '16 oz', 449, { bulk: '3 lb', brands: ['Jennie-O'] }),
  p('deli-turkey', 'Sliced Oven Roasted Turkey Breast', 'meat', '9 oz', 449, {
    bulk: '2 x 16 oz',
    brands: ['Oscar Mayer', "Boar's Head"],
    aliases: ['deli turkey', 'turkey lunch meat'],
  }),
  p('deli-ham', 'Sliced Honey Ham', 'meat', '9 oz', 399, {
    bulk: '2 x 16 oz',
    brands: ['Oscar Mayer'],
    aliases: ['deli ham', 'ham lunch meat'],
  }),
  p('pepperoni', 'Sliced Pepperoni', 'meat', '6 oz', 299, {
    bulk: '2 x 16 oz',
    brands: ['Hormel'],
  }),

  // ───────── Seafood ─────────
  p('salmon-fillet', 'Atlantic Salmon Fillet', 'seafood', 'per lb', 999, {
    ...W,
    aliases: ['salmon'],
  }),
  p('tilapia', 'Frozen Tilapia Fillets', 'seafood', '2 lb', 799, {
    bulk: '4 lb',
    aliases: ['tilapia'],
  }),
  p('frozen-shrimp', 'Frozen Raw Shrimp', 'seafood', '2 lb', 1199, {
    bulk: '3 lb',
    aliases: ['shrimp'],
  }),
  p('canned-tuna', 'Chunk Light Tuna in Water', 'seafood', '5 oz', 119, {
    bulk: '8 x 5 oz',
    brands: ['StarKist', 'Bumble Bee'],
    aliases: ['tuna', 'canned tuna'],
  }),
  p('catfish', 'Catfish Fillets', 'seafood', 'per lb', 699, { ...W }),

  // ───────── Bakery & tortillas ─────────
  p('white-bread', 'White Sandwich Bread', 'bakery', '20 oz', 179, {
    bulk: '2 x 20 oz',
    brands: ["Mrs Baird's", "Nature's Own"],
    staple: true,
    aliases: ['bread', 'white bread'],
  }),
  p('wheat-bread', '100% Whole Wheat Bread', 'bakery', '24 oz', 249, {
    bulk: '2 x 24 oz',
    brands: ["Nature's Own", "Dave's Killer Bread"],
    aliases: ['wheat bread'],
  }),
  p('hamburger-buns', 'Hamburger Buns', 'bakery', '8 ct', 199, {
    bulk: '16 ct',
    brands: ["Mrs Baird's"],
    promo: 'grilling',
    aliases: ['buns', 'burger buns'],
  }),
  p('hot-dog-buns', 'Hot Dog Buns', 'bakery', '8 ct', 199, {
    bulk: '16 ct',
    brands: ["Mrs Baird's"],
    promo: 'grilling',
  }),
  p('flour-tortillas', 'Flour Tortillas', 'bakery', ['10 ct', '20 ct'], 249, {
    bulk: '30 ct',
    brands: ['Mission'],
    staple: true,
    aliases: ['tortillas'],
  }),
  p('corn-tortillas', 'Yellow Corn Tortillas', 'bakery', '30 ct', 229, {
    bulk: '80 ct',
    brands: ['Mission', 'Guerrero'],
  }),
  p('bagels', 'Plain Bagels', 'bakery', '6 ct', 299, { bulk: '12 ct', brands: ["Thomas'"] }),
  p('english-muffins', 'English Muffins', 'bakery', '6 ct', 249, {
    bulk: '12 ct',
    brands: ["Thomas'"],
  }),

  // ───────── Canned & condiments ─────────
  p('peanut-butter', 'Creamy Peanut Butter', 'pantry', ['16 oz', '40 oz'], 229, {
    bulk: '2 x 40 oz',
    brands: ['Jif', 'Skippy'],
    staple: true,
    aliases: ['peanut butter', 'pb'],
  }),
  p('grape-jelly', 'Grape Jelly', 'pantry', '18 oz', 249, {
    bulk: '2 x 32 oz',
    brands: ["Smucker's", "Welch's"],
    aliases: ['jelly'],
  }),
  p('black-beans', 'Canned Black Beans', 'pantry', '15 oz', 89, {
    bulk: '8 x 15 oz',
    brands: ["Bush's"],
    aliases: ['black beans'],
  }),
  p('pinto-beans', 'Canned Pinto Beans', 'pantry', '15 oz', 89, {
    bulk: '8 x 15 oz',
    brands: ['Ranch Style', "Bush's"],
    aliases: ['pinto beans', 'beans'],
  }),
  p('diced-tomatoes', 'Canned Diced Tomatoes', 'pantry', '14.5 oz', 99, {
    bulk: '8 x 14.5 oz',
    brands: ["Hunt's", 'Del Monte'],
    staple: true,
    aliases: ['diced tomatoes'],
  }),
  p('tomatoes-green-chilies', 'Diced Tomatoes & Green Chilies', 'pantry', '10 oz', 119, {
    bulk: '8 x 10 oz',
    brands: ['Ro-Tel'],
    aliases: ['rotel'],
  }),
  p('tomato-sauce', 'Tomato Sauce', 'pantry', '15 oz', 89, {
    bulk: '8 x 15 oz',
    brands: ["Hunt's"],
  }),
  p('chicken-broth', 'Chicken Broth', 'pantry', '32 fl oz', 199, {
    bulk: '6 x 32 fl oz',
    brands: ['Swanson', 'Pacific Foods'],
    aliases: ['chicken stock', 'broth'],
  }),
  p('canned-corn', 'Whole Kernel Corn', 'pantry', '15.25 oz', 89, {
    bulk: '12 x 15.25 oz',
    brands: ['Del Monte', 'Green Giant'],
    aliases: ['canned corn'],
  }),
  p('canned-green-beans', 'Cut Green Beans', 'pantry', '14.5 oz', 89, {
    bulk: '12 x 14.5 oz',
    brands: ['Del Monte'],
    aliases: ['canned green beans'],
  }),
  p('chicken-noodle-soup', 'Chicken Noodle Soup', 'pantry', '10.75 oz', 129, {
    bulk: '12 x 10.75 oz',
    brands: ["Campbell's"],
    aliases: ['soup'],
  }),
  p('salsa', 'Medium Chunky Salsa', 'pantry', '16 oz', 299, {
    bulk: '2 x 38 oz',
    brands: ['Pace', 'Tostitos'],
    staple: true,
    aliases: ['salsa'],
  }),
  p('refried-beans', 'Refried Beans', 'pantry', '16 oz', 129, {
    bulk: '8 x 16 oz',
    brands: ['Old El Paso', 'Rosarita'],
  }),
  p('olive-oil', 'Extra Virgin Olive Oil', 'pantry', ['16.9 fl oz', '51 fl oz'], 699, {
    bulk: '2 x 1 L',
    brands: ['Bertolli', 'California Olive Ranch'],
    aliases: ['olive oil', 'evoo'],
  }),
  p('vegetable-oil', 'Vegetable Oil', 'pantry', '48 fl oz', 399, {
    bulk: '1 gal',
    brands: ['Crisco', 'Wesson'],
    aliases: ['cooking oil'],
  }),
  p('honey', 'Pure Clover Honey', 'pantry', '12 oz', 499, {
    bulk: '48 oz',
    brands: ["Nature Nate's"],
    aliases: ['honey'],
  }),
  p('pancake-syrup', 'Original Pancake Syrup', 'pantry', '24 fl oz', 349, {
    bulk: '2 x 24 fl oz',
    brands: ["Mrs. Butterworth's", 'Log Cabin'],
    aliases: ['syrup'],
  }),
  p('mac-and-cheese', 'Macaroni & Cheese Dinner', 'pantry', '7.25 oz', 109, {
    bulk: '12 x 7.25 oz',
    brands: ['Kraft'],
    staple: true,
    aliases: ['mac and cheese', 'mac n cheese'],
  }),
  p('ramen', 'Chicken Ramen Noodle Soup', 'pantry', '6 x 3 oz', 199, {
    bulk: '24 x 3 oz',
    brands: ['Maruchan'],
    aliases: ['ramen noodles'],
  }),
  p('ketchup', 'Tomato Ketchup', 'pantry', '32 oz', 299, {
    bulk: '2 x 44 oz',
    brands: ['Heinz'],
    staple: true,
    aliases: ['ketchup', 'catsup'],
  }),
  p('mustard', 'Yellow Mustard', 'pantry', '14 oz', 129, {
    bulk: '2 x 30 oz',
    brands: ["French's"],
    aliases: ['mustard'],
  }),
  p('mayonnaise', 'Real Mayonnaise', 'pantry', '30 fl oz', 449, {
    bulk: '64 fl oz',
    brands: ["Hellmann's", "Duke's"],
    aliases: ['mayo'],
  }),
  p('bbq-sauce', 'Original BBQ Sauce', 'pantry', '18 oz', 229, {
    bulk: '2 x 40 oz',
    brands: ["Sweet Baby Ray's", "Stubb's"],
    promo: 'grilling',
    aliases: ['barbecue sauce', 'bbq sauce'],
  }),
  p('ranch-dressing', 'Ranch Dressing', 'pantry', '16 fl oz', 299, {
    bulk: '40 fl oz',
    brands: ['Hidden Valley'],
    aliases: ['ranch'],
  }),
  p('soy-sauce', 'Soy Sauce', 'pantry', '15 fl oz', 299, {
    bulk: '64 fl oz',
    brands: ['Kikkoman'],
  }),

  // ───────── Pasta, rice & grains ─────────
  p('spaghetti', 'Spaghetti', 'pasta-grains', '16 oz', 129, {
    bulk: '6 x 16 oz',
    brands: ['Barilla'],
    staple: true,
    aliases: ['spaghetti noodles', 'pasta'],
  }),
  p('penne', 'Penne Pasta', 'pasta-grains', '16 oz', 129, {
    bulk: '6 x 16 oz',
    brands: ['Barilla'],
    aliases: ['penne'],
  }),
  p('elbow-macaroni', 'Elbow Macaroni', 'pasta-grains', '16 oz', 119, {
    bulk: '6 x 16 oz',
    brands: ['Barilla'],
  }),
  p('pasta-sauce', 'Traditional Pasta Sauce', 'pasta-grains', '24 oz', 249, {
    bulk: '3 x 24 oz',
    brands: ['Prego', 'Ragu'],
    staple: true,
    aliases: ['spaghetti sauce', 'marinara'],
  }),
  p('white-rice', 'Long Grain White Rice', 'pasta-grains', ['2 lb', '5 lb'], 229, {
    bulk: '25 lb',
    brands: ['Mahatma', 'Riceland'],
    staple: true,
    aliases: ['rice', 'white rice'],
  }),
  p('brown-rice', 'Long Grain Brown Rice', 'pasta-grains', '2 lb', 249, {
    bulk: '12 lb',
    brands: ['Mahatma'],
    aliases: ['brown rice'],
  }),
  p('jasmine-rice', 'Jasmine Rice', 'pasta-grains', '5 lb', 699, {
    bulk: '25 lb',
    brands: ['Mahatma'],
  }),
  p('quinoa', 'Organic Quinoa', 'pasta-grains', '16 oz', 499, {
    bulk: '4.5 lb',
    attrs: { organic: true },
  }),

  // ───────── Breakfast & cereal ─────────
  p('toasted-oats-cereal', 'Toasted Whole Grain Oat Cereal', 'breakfast', '18 oz', 399, {
    bulk: '2 x 20 oz',
    brands: ['Cheerios'],
    staple: true,
    aliases: ['cheerios', 'oat cereal', 'cereal'],
  }),
  p('frosted-flakes', 'Frosted Flakes Cereal', 'breakfast', '24 oz', 499, {
    bulk: '2 x 24 oz',
    brands: ["Kellogg's"],
    aliases: ['frosted flakes'],
  }),
  p('raisin-bran', 'Raisin Bran Cereal', 'breakfast', '18.7 oz', 399, {
    bulk: '2 x 18.7 oz',
    brands: ["Kellogg's", 'Post'],
  }),
  p('rolled-oats', 'Old Fashioned Rolled Oats', 'breakfast', '42 oz', 449, {
    bulk: '2 x 42 oz',
    brands: ['Quaker'],
    aliases: ['oatmeal', 'oats'],
  }),
  p('granola', 'Oats & Honey Granola', 'breakfast', '12 oz', 399, {
    bulk: '35 oz',
    brands: ['Nature Valley'],
  }),
  p('pancake-mix', 'Buttermilk Pancake Mix', 'breakfast', '32 oz', 299, {
    bulk: '10 lb',
    brands: ['Krusteaz', 'Pearl Milling Company'],
    aliases: ['pancake mix'],
  }),
  p('ground-coffee', 'Medium Roast Ground Coffee', 'beverages', ['30.5 oz', '11.5 oz'], 1099, {
    bulk: '48 oz',
    brands: ['Folgers', 'Maxwell House'],
    staple: true,
    aliases: ['coffee'],
  }),
  p('coffee-pods', 'Medium Roast Coffee Pods', 'beverages', ['12 ct', '24 ct'], 799, {
    bulk: '100 ct',
    brands: ['Green Mountain', 'The Original Donut Shop'],
    aliases: ['k-cups', 'k cups'],
  }),

  // ───────── Snacks ─────────
  p('tortilla-chips', 'Restaurant Style Tortilla Chips', 'snacks', '13 oz', 299, {
    bulk: '2 x 13 oz',
    brands: ['Tostitos', 'Mission'],
    staple: true,
    aliases: ['chips', 'tortilla chips'],
  }),
  p('potato-chips', 'Classic Potato Chips', 'snacks', '8 oz', 399, {
    bulk: '2 x 8 oz',
    brands: ["Lay's"],
    aliases: ['potato chips'],
  }),
  p('pretzels', 'Mini Twist Pretzels', 'snacks', '16 oz', 299, {
    bulk: '2 x 16 oz',
    brands: ['Rold Gold', "Snyder's"],
  }),
  p('microwave-popcorn', 'Butter Microwave Popcorn', 'snacks', '6 ct', 349, {
    bulk: '32 ct',
    brands: ["Orville Redenbacher's", 'Pop Secret'],
    aliases: ['popcorn'],
  }),
  p('saltine-crackers', 'Saltine Crackers', 'snacks', '16 oz', 249, {
    bulk: '2 x 16 oz',
    brands: ['Premium'],
    aliases: ['saltines', 'crackers'],
  }),
  p('cheese-crackers', 'Baked Cheese Crackers', 'snacks', '12.4 oz', 449, {
    bulk: '48 oz',
    brands: ['Cheez-It'],
    aliases: ['cheez its'],
  }),
  p('granola-bars', 'Chewy Granola Bars', 'snacks', '12 ct', 399, {
    bulk: '48 ct',
    brands: ['Nature Valley', 'Quaker Chewy'],
    staple: true,
    aliases: ['granola bars'],
  }),
  p('fruit-snacks', 'Mixed Fruit Snacks', 'snacks', '10 ct', 299, {
    bulk: '40 ct',
    brands: ["Welch's"],
  }),
  p('mixed-nuts', 'Lightly Salted Mixed Nuts', 'snacks', '16 oz', 699, {
    bulk: '2.5 lb',
    brands: ['Planters'],
    aliases: ['mixed nuts', 'nuts'],
  }),
  p('almonds', 'Whole Natural Almonds', 'snacks', '16 oz', 599, {
    bulk: '3 lb',
    brands: ['Blue Diamond'],
    aliases: ['almonds'],
  }),
  p('chocolate-chip-cookies', 'Chocolate Chip Cookies', 'snacks', '13 oz', 399, {
    bulk: '2 x 13 oz',
    brands: ['Chips Ahoy!'],
    aliases: ['cookies'],
  }),
  p('sandwich-cookies', 'Chocolate Sandwich Cookies', 'snacks', '14.3 oz', 449, {
    bulk: '2 x 14.3 oz',
    brands: ['Oreo'],
    aliases: ['oreos'],
  }),

  // ───────── Beverages ─────────
  p('tea-bags', 'Black Tea Bags', 'beverages', '100 ct', 349, {
    bulk: '312 ct',
    brands: ['Lipton', 'Luzianne'],
    aliases: ['tea', 'iced tea bags'],
  }),
  p('orange-juice', '100% Orange Juice', 'beverages', ['52 fl oz', '89 fl oz'], 399, {
    bulk: '2 x 89 fl oz',
    brands: ['Simply Orange', 'Tropicana'],
    staple: true,
    aliases: ['oj', 'orange juice'],
  }),
  p('apple-juice', '100% Apple Juice', 'beverages', '64 fl oz', 299, {
    bulk: '2 x 96 fl oz',
    brands: ["Mott's"],
    aliases: ['apple juice'],
  }),
  p('lemonade', 'Lemonade', 'beverages', '52 fl oz', 299, { brands: ['Simply Lemonade'] }),
  p('cola', 'Cola Soda 12 Pack', 'beverages', '12 x 12 fl oz', 699, {
    bulk: '35 x 12 fl oz',
    brands: ['Coca-Cola', 'Pepsi'],
    staple: true,
    aliases: ['coke', 'soda', 'cola'],
  }),
  p('pepper-soda', 'Pepper Soda 12 Pack', 'beverages', '12 x 12 fl oz', 699, {
    bulk: '35 x 12 fl oz',
    brands: ['Dr Pepper'],
    aliases: ['dr pepper', 'pepper soda'],
  }),
  p('lemon-lime-soda', 'Lemon-Lime Soda 12 Pack', 'beverages', '12 x 12 fl oz', 699, {
    bulk: '35 x 12 fl oz',
    brands: ['Sprite', '7UP'],
    aliases: ['sprite', 'lemon lime soda'],
  }),
  p('sparkling-water', 'Sparkling Mineral Water', 'beverages', '8 x 12 fl oz', 449, {
    bulk: '24 x 12 fl oz',
    brands: ['LaCroix', 'Topo Chico'],
    aliases: ['sparkling water', 'topo chico'],
  }),
  p('bottled-water', 'Purified Bottled Water', 'beverages', '24 x 16.9 fl oz', 449, {
    bulk: '40 x 16.9 fl oz',
    brands: ['Ozarka', 'Dasani'],
    staple: true,
    aliases: ['water', 'water bottles'],
  }),
  p('sports-drink', 'Fruit Punch Sports Drink', 'beverages', '8 x 20 fl oz', 699, {
    bulk: '24 x 20 fl oz',
    brands: ['Gatorade', 'Powerade'],
    aliases: ['gatorade'],
  }),

  // ───────── Frozen ─────────
  p('frozen-pizza', 'Frozen Pepperoni Pizza', 'frozen', '20 oz', 499, {
    bulk: '3 x 26 oz',
    brands: ['DiGiorno', 'Red Baron'],
    aliases: ['pizza'],
  }),
  p('frozen-broccoli', 'Frozen Broccoli Florets', 'frozen', '16 oz', 179, {
    bulk: '4 lb',
    brands: ['Birds Eye', 'Green Giant'],
  }),
  p('frozen-mixed-veg', 'Frozen Mixed Vegetables', 'frozen', '16 oz', 149, {
    bulk: '5 lb',
    brands: ['Birds Eye'],
    aliases: ['mixed vegetables'],
  }),
  p('frozen-peas', 'Frozen Sweet Peas', 'frozen', '16 oz', 149, {
    brands: ['Birds Eye'],
    aliases: ['peas'],
  }),
  p('frozen-berries', 'Frozen Mixed Berries', 'frozen', ['16 oz', '48 oz'], 399, {
    bulk: '4 lb',
    aliases: ['frozen fruit'],
  }),
  p('vanilla-ice-cream', 'Vanilla Ice Cream', 'frozen', ['48 fl oz', '0.5 gal'], 449, {
    bulk: '2 x 0.5 gal',
    brands: ['Blue Bell'],
    aliases: ['ice cream'],
  }),
  p('frozen-waffles', 'Homestyle Frozen Waffles', 'frozen', '10 ct', 299, {
    bulk: '48 ct',
    brands: ['Eggo'],
    aliases: ['waffles', 'eggos'],
  }),
  p('chicken-nuggets', 'Frozen Chicken Nuggets', 'frozen', '2 lb', 799, {
    bulk: '5 lb',
    brands: ['Tyson'],
    aliases: ['nuggets'],
  }),
  p('frozen-burritos', 'Bean & Cheese Burritos', 'frozen', '8 x 5 oz', 549, {
    bulk: '24 x 5 oz',
    brands: ['El Monterey'],
    aliases: ['burritos'],
  }),
  p('french-fries', 'Frozen Crinkle Cut Fries', 'frozen', '32 oz', 349, {
    bulk: '5 lb',
    brands: ['Ore-Ida'],
    aliases: ['fries', 'french fries'],
  }),

  // ───────── Baking & spices ─────────
  p('all-purpose-flour', 'All-Purpose Flour', 'baking', '5 lb', 329, {
    bulk: '25 lb',
    brands: ['Gold Medal', 'Pioneer'],
    promo: 'baking',
    aliases: ['flour'],
  }),
  p('granulated-sugar', 'Granulated Sugar', 'baking', '4 lb', 329, {
    bulk: '25 lb',
    brands: ['Imperial Sugar'],
    promo: 'baking',
    aliases: ['sugar'],
  }),
  p('brown-sugar', 'Light Brown Sugar', 'baking', '2 lb', 249, {
    bulk: '7 lb',
    brands: ['Imperial Sugar'],
    promo: 'baking',
  }),
  p('powdered-sugar', 'Powdered Sugar', 'baking', '2 lb', 249, {
    bulk: '7 lb',
    brands: ['Imperial Sugar'],
    promo: 'baking',
    aliases: ['confectioners sugar'],
  }),
  p('baking-soda', 'Baking Soda', 'baking', '16 oz', 129, {
    bulk: '13.5 lb',
    brands: ['Arm & Hammer'],
  }),
  p('baking-powder', 'Double Acting Baking Powder', 'baking', '10 oz', 349, {
    brands: ['Clabber Girl'],
    promo: 'baking',
  }),
  p('vanilla-extract', 'Pure Vanilla Extract', 'baking', '2 fl oz', 799, {
    bulk: '16 fl oz',
    brands: ['McCormick'],
    promo: 'baking',
    aliases: ['vanilla'],
  }),
  p('chocolate-chips', 'Semi-Sweet Chocolate Chips', 'baking', '12 oz', 299, {
    bulk: '4.5 lb',
    brands: ['Nestle Toll House'],
    promo: 'baking',
  }),
  p('ground-cinnamon', 'Ground Cinnamon', 'baking', '2.37 oz', 199, {
    bulk: '10.5 oz',
    brands: ['McCormick'],
    aliases: ['cinnamon'],
  }),
  p('black-pepper', 'Ground Black Pepper', 'baking', '3 oz', 349, {
    bulk: '12.75 oz',
    brands: ['McCormick'],
    aliases: ['pepper'],
  }),
  p('table-salt', 'Iodized Salt', 'baking', '26 oz', 109, {
    brands: ['Morton'],
    aliases: ['salt'],
  }),
  p('chili-powder', 'Chili Powder', 'baking', '2.5 oz', 199, { brands: ['Gebhardt', 'McCormick'] }),
  p('canned-pumpkin', '100% Pure Pumpkin', 'baking', '15 oz', 179, {
    bulk: '3 x 29 oz',
    brands: ["Libby's"],
    promo: 'baking',
    aliases: ['pumpkin puree', 'pumpkin'],
  }),
  p('pecans', 'Pecan Halves', 'baking', '16 oz', 999, {
    bulk: '2 lb',
    promo: 'baking',
    aliases: ['pecans'],
  }),
  p('evaporated-milk', 'Evaporated Milk', 'baking', '12 fl oz', 149, {
    bulk: '12 x 12 fl oz',
    brands: ['Carnation', 'Pet'],
    promo: 'baking',
  }),

  // ───────── Household & baby ─────────
  p('paper-towels', 'Paper Towels', 'household', '6 rolls', 899, {
    bulk: '12 rolls',
    brands: ['Bounty', 'Viva'],
  }),
  p('toilet-paper', 'Toilet Paper', 'household', '12 rolls', 999, {
    bulk: '30 rolls',
    brands: ['Charmin', 'Angel Soft'],
    staple: true,
    aliases: ['tp', 'bath tissue'],
  }),
  p('dish-soap', 'Dish Soap', 'household', '19.4 fl oz', 349, {
    bulk: '90 fl oz',
    brands: ['Dawn'],
  }),
  p('laundry-detergent', 'Liquid Laundry Detergent', 'household', '92 fl oz', 1299, {
    bulk: '146 fl oz',
    brands: ['Tide', 'Gain'],
    aliases: ['detergent'],
  }),
  p('trash-bags', 'Tall Kitchen Trash Bags', 'household', '45 ct', 999, {
    bulk: '90 ct',
    brands: ['Glad', 'Hefty'],
    aliases: ['trash bags', 'garbage bags'],
  }),
  p('sandwich-bags', 'Zipper Sandwich Bags', 'household', '100 ct', 299, {
    bulk: '300 ct',
    brands: ['Ziploc'],
    aliases: ['ziploc bags'],
  }),
  p('dishwasher-pods', 'Dishwasher Detergent Pods', 'household', '42 ct', 1199, {
    bulk: '90 ct',
    brands: ['Cascade', 'Finish'],
  }),
  p('diapers', 'Diapers Size 3', 'household', '84 ct', 1999, {
    bulk: '168 ct',
    brands: ['Pampers', 'Huggies'],
  }),
  p('baby-wipes', 'Unscented Baby Wipes', 'household', ['72 ct', '216 ct'], 349, {
    bulk: '900 ct',
    brands: ['Pampers', 'Huggies'],
    aliases: ['wipes'],
  }),
];
