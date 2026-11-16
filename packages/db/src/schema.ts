/**
 * Drizzle schema. Mirrors docs/schema.sql (SPEC Appendix A); a parity test diffs the migrated
 * database against that DDL. Functions (unit_factor, unit_dim), the store_items dimension trigger
 * and the price_points exclusion constraint are not expressible in Drizzle and live as custom SQL
 * in migrations/0000.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  char,
  check,
  customType,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
  bigint,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

// ───────────── custom types ─────────────
const citext = customType<{ data: string }>({ dataType: () => 'citext' });
const tsvector = customType<{ data: string }>({ dataType: () => 'tsvector' });
const inet = customType<{ data: string }>({ dataType: () => 'inet' });
const bytea = customType<{ data: Buffer }>({ dataType: () => 'bytea' });
/** Postgres daterange as its text form, e.g. "[2026-01-01,2026-01-08)" or "[2026-01-08,)". */
const daterange = customType<{ data: string }>({ dataType: () => 'daterange' });

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const num = (name: string, precision: number, scale: number) =>
  numeric(name, { precision, scale, mode: 'number' });

// ───────────── enums ─────────────
export const unitDimension = pgEnum('unit_dimension', ['mass', 'volume', 'count']);
export const unitCode = pgEnum('unit_code', [
  'g',
  'kg',
  'oz',
  'lb',
  'ml',
  'l',
  'fl_oz',
  'pt',
  'qt',
  'gal',
  'ea',
  'dozen',
]);
export const pricingBasis = pgEnum('pricing_basis', ['per_package', 'per_weight']);
export const matchMethod = pgEnum('match_method', ['upc', 'rule', 'fuzzy', 'manual']);
export const matchMode = pgEnum('match_mode', ['any', 'brand', 'exact_item']);
export const promoType = pgEnum('promo_type', ['none', 'sale', 'clearance', 'member', 'multi_buy']);
export const authProvider = pgEnum('auth_provider', ['google']);
export const alertKind = pgEnum('alert_kind', ['historic_low', 'target_price']);
export const planType = pgEnum('plan_type', ['single', 'multi']);
export const themePref = pgEnum('theme_pref', ['system', 'light', 'dark']);

// ───────────── stores ─────────────
export const stores = pgTable(
  'stores',
  {
    id: smallint('id').primaryKey().generatedAlwaysAsIdentity(),
    slug: text('slug').notNull().unique(),
    name: text('name').notNull(),
    requiresMembership: boolean('requires_membership').notNull().default(false),
    membershipFeeCents: integer('membership_fee_cents'),
    loyaltyProgram: text('loyalty_program'),
    brandColor: char('brand_color', { length: 7 }).notNull(),
    sortOrder: smallint('sort_order').notNull().default(0),
  },
  (t) => [check('stores_membership_fee_cents_check', sql`${t.membershipFeeCents} >= 0`)],
);

export const storeLocations = pgTable(
  'store_locations',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    storeId: smallint('store_id')
      .notNull()
      .references(() => stores.id),
    name: text('name').notNull(),
    address: text('address').notNull(),
    city: text('city').notNull(),
    zip: char('zip', { length: 5 }).notNull(),
    metro: text('metro').notNull().default('DFW'),
    lat: num('lat', 9, 6).notNull(),
    lng: num('lng', 9, 6).notNull(),
    externalRef: text('external_ref'),
  },
  (t) => [
    unique('store_locations_store_id_external_ref_key').on(t.storeId, t.externalRef),
    index('store_locations_store_metro_idx').on(t.storeId, t.metro),
    check('store_locations_lat_check', sql`${t.lat} BETWEEN -90 AND 90`),
    check('store_locations_lng_check', sql`${t.lng} BETWEEN -180 AND 180`),
  ],
);

// ───────────── users & auth ─────────────
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: citext('email').notNull().unique(),
    passwordHash: text('password_hash'),
    displayName: text('display_name').notNull(),
    homeZip: char('home_zip', { length: 5 }),
    homeLat: num('home_lat', 9, 6),
    homeLng: num('home_lng', 9, 6),
    vehicleMpg: num('vehicle_mpg', 4, 1).notNull().default(25),
    fuelCentsPerGal: integer('fuel_cents_per_gal'),
    baselineStoreId: smallint('baseline_store_id').references(() => stores.id),
    theme: themePref('theme').notNull().default('system'),
    onboardedAt: ts('onboarded_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    check('users_vehicle_mpg_check', sql`${t.vehicleMpg} > 0`),
    check('users_fuel_cents_per_gal_check', sql`${t.fuelCentsPerGal} > 0`),
    check('users_home_latlng_check', sql`(${t.homeLat} IS NULL) = (${t.homeLng} IS NULL)`),
  ],
);

export const authIdentities = pgTable(
  'auth_identities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: authProvider('provider').notNull(),
    providerSubject: text('provider_subject').notNull(),
    email: citext('email'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    unique('auth_identities_provider_provider_subject_key').on(t.provider, t.providerSubject),
    unique('auth_identities_user_id_provider_key').on(t.userId, t.provider),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    familyId: uuid('family_id').notNull(),
    refreshTokenHash: bytea('refresh_token_hash').notNull().unique(),
    expiresAt: ts('expires_at').notNull(),
    rotatedAt: ts('rotated_at'),
    revokedAt: ts('revoked_at'),
    userAgent: text('user_agent'),
    ip: inet('ip'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('sessions_user_idx').on(t.userId), index('sessions_family_idx').on(t.familyId)],
);

export const userStores = pgTable(
  'user_stores',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    storeId: smallint('store_id')
      .notNull()
      .references(() => stores.id),
    enabled: boolean('enabled').notNull().default(true),
    hasMembership: boolean('has_membership').notNull().default(false),
    hasLoyalty: boolean('has_loyalty').notNull().default(true),
    preferredLocationId: integer('preferred_location_id').references(() => storeLocations.id),
  },
  (t) => [primaryKey({ columns: [t.userId, t.storeId] })],
);

// ───────────── catalog ─────────────
export const categories = pgTable('categories', {
  id: smallint('id').primaryKey().generatedAlwaysAsIdentity(),
  parentId: smallint('parent_id').references((): AnyPgColumn => categories.id),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  icon: text('icon'),
  sortOrder: smallint('sort_order').notNull().default(0),
});

export const products = pgTable(
  'products',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull().unique(),
    name: text('name').notNull(),
    categoryId: smallint('category_id')
      .notNull()
      .references(() => categories.id),
    dimension: unitDimension('dimension').notNull(),
    displayUnit: unitCode('display_unit').notNull(),
    defaultQuantity: num('default_quantity', 10, 3).notNull(),
    defaultUnit: unitCode('default_unit').notNull(),
    avgEachGrams: num('avg_each_grams', 10, 2),
    attributes: jsonb('attributes')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    search: tsvector('search').generatedAlwaysAs(sql`to_tsvector('english', name)`),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('products_category_idx').on(t.categoryId),
    index('products_search_idx').using('gin', t.search),
    index('products_name_trgm').using('gin', t.name.op('gin_trgm_ops')),
    check('products_default_quantity_check', sql`${t.defaultQuantity} > 0`),
    check('products_avg_each_grams_check', sql`${t.avgEachGrams} > 0`),
    check('products_display_unit_check', sql`unit_dim(${t.displayUnit}) = ${t.dimension}`),
    check(
      'products_default_unit_check',
      sql`unit_dim(${t.defaultUnit}) = ${t.dimension} OR (${t.avgEachGrams} IS NOT NULL AND ${t.dimension} IN ('mass','count') AND unit_dim(${t.defaultUnit}) IN ('mass','count'))`,
    ),
  ],
);

export const productAliases = pgTable(
  'product_aliases',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    alias: text('alias').notNull(),
    source: text('source').notNull().default('seed'),
  },
  (t) => [
    uniqueIndex('product_aliases_alias_uq').on(sql`lower(${t.alias})`),
    index('product_aliases_trgm').using('gin', t.alias.op('gin_trgm_ops')),
    check('product_aliases_source_check', sql`${t.source} IN ('seed','user','import')`),
  ],
);

export const storeItems = pgTable(
  'store_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: smallint('store_id')
      .notNull()
      .references(() => stores.id),
    productId: uuid('product_id').references(() => products.id),
    sku: text('sku').notNull(),
    upc: varchar('upc', { length: 14 }),
    title: text('title').notNull(),
    brand: text('brand'),
    isStoreBrand: boolean('is_store_brand').notNull().default(false),
    packCount: integer('pack_count').notNull().default(1),
    unitQuantity: num('unit_quantity', 12, 4).notNull(),
    unit: unitCode('unit').notNull(),
    baseQuantity: num('base_quantity', 16, 4).generatedAlwaysAs(
      sql`pack_count * unit_quantity * unit_factor(unit)`,
    ),
    pricingBasis: pricingBasis('pricing_basis').notNull().default('per_package'),
    matchMethod: matchMethod('match_method'),
    matchConfidence: num('match_confidence', 4, 3),
    matchReviewed: boolean('match_reviewed').notNull().default(false),
    active: boolean('active').notNull().default(true),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    unique('store_items_store_id_sku_key').on(t.storeId, t.sku),
    index('store_items_product_idx')
      .on(t.productId)
      .where(sql`active`),
    index('store_items_upc_idx')
      .on(t.upc)
      .where(sql`upc IS NOT NULL`),
    check('store_items_pack_count_check', sql`${t.packCount} > 0`),
    check('store_items_unit_quantity_check', sql`${t.unitQuantity} > 0`),
    check('store_items_match_confidence_check', sql`${t.matchConfidence} BETWEEN 0 AND 1`),
    check(
      'store_items_per_weight_check',
      sql`${t.pricingBasis} = 'per_package' OR (${t.packCount} = 1 AND ${t.unitQuantity} = 1 AND unit_dim(${t.unit}) = 'mass')`,
    ),
    check('store_items_match_check', sql`(${t.productId} IS NULL) = (${t.matchMethod} IS NULL)`),
  ],
);

// ───────────── prices ─────────────
export const pricePoints = pgTable(
  'price_points',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    storeItemId: uuid('store_item_id')
      .notNull()
      .references(() => storeItems.id, { onDelete: 'cascade' }),
    metro: text('metro').notNull().default('DFW'),
    storeLocationId: integer('store_location_id').references(() => storeLocations.id),
    validDuring: daterange('valid_during').notNull(),
    regularPriceCents: integer('regular_price_cents').notNull(),
    salePriceCents: integer('sale_price_cents'),
    effectivePriceCents: integer('effective_price_cents').generatedAlwaysAs(
      sql`COALESCE(sale_price_cents, regular_price_cents)`,
    ),
    promoType: promoType('promo_type').notNull().default('none'),
    promoLabel: text('promo_label'),
    minQty: smallint('min_qty').notNull().default(1),
    memberOnly: boolean('member_only').notNull().default(false),
    source: text('source').notNull(),
    observedAt: ts('observed_at').notNull().defaultNow(),
  },
  (t) => [
    index('price_points_item_from_idx').on(t.storeItemId, sql`lower(${t.validDuring}) DESC`),
    index('price_points_current_idx')
      .on(t.storeItemId)
      .where(sql`upper_inf(valid_during)`),
    check('price_points_valid_during_check', sql`NOT isempty(${t.validDuring})`),
    check('price_points_regular_price_cents_check', sql`${t.regularPriceCents} > 0`),
    check('price_points_sale_price_cents_check', sql`${t.salePriceCents} > 0`),
    check('price_points_min_qty_check', sql`${t.minQty} >= 1`),
    check(
      'price_points_sale_lt_regular_check',
      sql`${t.salePriceCents} IS NULL OR ${t.salePriceCents} < ${t.regularPriceCents}`,
    ),
    check(
      'price_points_promo_check',
      sql`(${t.salePriceCents} IS NULL) = (${t.promoType} = 'none')`,
    ),
  ],
);

export const providerSyncRuns = pgTable(
  'provider_sync_runs',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    provider: text('provider').notNull(),
    startedAt: ts('started_at').notNull().defaultNow(),
    finishedAt: ts('finished_at'),
    status: text('status').notNull().default('running'),
    itemsUpserted: integer('items_upserted').notNull().default(0),
    pricePointsWritten: integer('price_points_written').notNull().default(0),
    unmatchedItems: integer('unmatched_items').notNull().default(0),
    error: text('error'),
  },
  (t) => [check('provider_sync_runs_status_check', sql`${t.status} IN ('running','ok','failed')`)],
);

// ───────────── lists ─────────────
export const groceryLists = pgTable(
  'grocery_lists',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    isTemplate: boolean('is_template').notNull().default(false),
    archivedAt: ts('archived_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('grocery_lists_user_idx')
      .on(t.userId, t.isTemplate)
      .where(sql`archived_at IS NULL`),
    check('grocery_lists_name_check', sql`length(${t.name}) BETWEEN 1 AND 120`),
    check('grocery_lists_owner_check', sql`${t.userId} IS NOT NULL OR ${t.isTemplate}`),
  ],
);

export const listItems = pgTable(
  'list_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    listId: uuid('list_id')
      .notNull()
      .references(() => groceryLists.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    rawText: text('raw_text').notNull(),
    productId: uuid('product_id').references(() => products.id),
    quantity: num('quantity', 10, 3).notNull().default(1),
    unit: unitCode('unit'),
    matchMode: matchMode('match_mode').notNull().default('any'),
    brand: text('brand'),
    storeItemId: uuid('store_item_id').references(() => storeItems.id),
    categoryId: smallint('category_id').references(() => categories.id),
    checked: boolean('checked').notNull().default(false),
    notes: text('notes'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('list_items_list_pos_idx').on(t.listId, t.position),
    check('list_items_raw_text_check', sql`length(${t.rawText}) BETWEEN 1 AND 200`),
    check('list_items_quantity_check', sql`${t.quantity} > 0`),
    check('list_items_brand_check', sql`${t.matchMode} <> 'brand' OR ${t.brand} IS NOT NULL`),
    check(
      'list_items_exact_item_check',
      sql`${t.matchMode} <> 'exact_item' OR ${t.storeItemId} IS NOT NULL`,
    ),
    check('list_items_unit_check', sql`${t.unit} IS NULL OR ${t.productId} IS NOT NULL`),
  ],
);

// ───────────── alerts ─────────────
export const priceAlerts = pgTable(
  'price_alerts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    kind: alertKind('kind').notNull(),
    targetCents: integer('target_cents'),
    active: boolean('active').notNull().default(true),
    lastTriggeredAt: ts('last_triggered_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    unique('price_alerts_user_id_product_id_kind_key').on(t.userId, t.productId, t.kind),
    check('price_alerts_target_cents_check', sql`${t.targetCents} > 0`),
    check(
      'price_alerts_kind_target_check',
      sql`(${t.kind} = 'target_price') = (${t.targetCents} IS NOT NULL)`,
    ),
  ],
);

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    alertId: uuid('alert_id').references(() => priceAlerts.id, { onDelete: 'set null' }),
    kind: text('kind').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    dedupeKey: text('dedupe_key').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
    readAt: ts('read_at'),
  },
  (t) => [
    unique('notifications_user_id_dedupe_key_key').on(t.userId, t.dedupeKey),
    index('notifications_unread_idx')
      .on(t.userId, sql`created_at DESC`)
      .where(sql`read_at IS NULL`),
  ],
);

// ───────────── trips ─────────────
export const trips = pgTable(
  'trips',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    listId: uuid('list_id').references(() => groceryLists.id, { onDelete: 'set null' }),
    planType: planType('plan_type').notNull(),
    storeIds: smallint('store_ids').array().notNull(),
    baselineStoreId: smallint('baseline_store_id')
      .notNull()
      .references(() => stores.id),
    itemsTotalCents: integer('items_total_cents').notNull(),
    fuelCostCents: integer('fuel_cost_cents').notNull().default(0),
    distanceMiles: num('distance_miles', 7, 2).notNull().default(0),
    baselineTotalCents: integer('baseline_total_cents').notNull(),
    savingsCents: integer('savings_cents').generatedAlwaysAs(
      sql`baseline_total_cents - items_total_cents - fuel_cost_cents`,
    ),
    priceAsOf: date('price_as_of', { mode: 'string' }).notNull(),
    shoppedOn: date('shopped_on', { mode: 'string' }).notNull(),
    plan: jsonb('plan').$type<Record<string, unknown>>().notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('trips_user_date_idx').on(t.userId, sql`shopped_on DESC`),
    check('trips_store_ids_check', sql`cardinality(${t.storeIds}) >= 1`),
    check('trips_items_total_cents_check', sql`${t.itemsTotalCents} >= 0`),
    check('trips_fuel_cost_cents_check', sql`${t.fuelCostCents} >= 0`),
    check('trips_baseline_total_cents_check', sql`${t.baselineTotalCents} >= 0`),
  ],
);

export const tripItems = pgTable(
  'trip_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tripId: uuid('trip_id')
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    productId: uuid('product_id').references(() => products.id),
    storeItemId: uuid('store_item_id').references(() => storeItems.id),
    storeId: smallint('store_id')
      .notNull()
      .references(() => stores.id),
    categoryId: smallint('category_id').references(() => categories.id),
    packages: integer('packages'),
    baseQuantity: num('base_quantity', 16, 4).notNull(),
    lineTotalCents: integer('line_total_cents').notNull(),
    baselineLineCents: integer('baseline_line_cents').notNull(),
  },
  (t) => [
    index('trip_items_trip_idx').on(t.tripId),
    check('trip_items_packages_check', sql`${t.packages} > 0`),
    check('trip_items_base_quantity_check', sql`${t.baseQuantity} > 0`),
    check('trip_items_line_total_cents_check', sql`${t.lineTotalCents} >= 0`),
    check('trip_items_baseline_line_cents_check', sql`${t.baselineLineCents} >= 0`),
  ],
);
