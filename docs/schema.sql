-- Smart Grocery Saver — reference DDL (PostgreSQL 16+)
-- Source of truth for intent. Drizzle schema in packages/db must produce an
-- equivalent database; a Phase 1 test diffs them.

CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ───────────────────────── Units ─────────────────────────
CREATE TYPE unit_dimension AS ENUM ('mass', 'volume', 'count');
CREATE TYPE unit_code AS ENUM (
  'g', 'kg', 'oz', 'lb',                 -- mass   → base g
  'ml', 'l', 'fl_oz', 'pt', 'qt', 'gal', -- volume → base ml
  'ea', 'dozen'                          -- count  → base ea
);

-- Factor to base unit. MUST match packages/core/src/units/table.ts (parity test).
CREATE FUNCTION unit_factor(u unit_code) RETURNS numeric
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE u
    WHEN 'g' THEN 1 WHEN 'kg' THEN 1000
    WHEN 'oz' THEN 28.349523125 WHEN 'lb' THEN 453.59237
    WHEN 'ml' THEN 1 WHEN 'l' THEN 1000
    WHEN 'fl_oz' THEN 29.5735295625 WHEN 'pt' THEN 473.176473
    WHEN 'qt' THEN 946.352946 WHEN 'gal' THEN 3785.411784
    WHEN 'ea' THEN 1 WHEN 'dozen' THEN 12
  END::numeric
$$;

CREATE FUNCTION unit_dim(u unit_code) RETURNS unit_dimension
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE
    WHEN u IN ('g','kg','oz','lb') THEN 'mass'
    WHEN u IN ('ml','l','fl_oz','pt','qt','gal') THEN 'volume'
    ELSE 'count'
  END::unit_dimension
$$;

CREATE TYPE pricing_basis  AS ENUM ('per_package', 'per_weight');
CREATE TYPE match_method   AS ENUM ('upc', 'rule', 'fuzzy', 'manual');
CREATE TYPE match_mode     AS ENUM ('any', 'brand', 'exact_item');
CREATE TYPE promo_type     AS ENUM ('none', 'sale', 'clearance', 'member', 'multi_buy');
CREATE TYPE auth_provider  AS ENUM ('google');
CREATE TYPE alert_kind     AS ENUM ('historic_low', 'target_price');
CREATE TYPE plan_type      AS ENUM ('single', 'multi');
CREATE TYPE theme_pref     AS ENUM ('system', 'light', 'dark');

-- ───────────────────────── Stores ─────────────────────────
CREATE TABLE stores (
  id                   smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug                 text NOT NULL UNIQUE,          -- 'walmart','costco','sams','target','kroger','heb','aldi',
                                                      -- 'tomthumb','sprouts','traderjoes'
  name                 text NOT NULL,
  requires_membership  boolean NOT NULL DEFAULT false,
  membership_fee_cents integer CHECK (membership_fee_cents >= 0),
  loyalty_program      text,                          -- free card program: 'Tom Thumb for U', 'Kroger Plus Card'; NULL = none
  brand_color          char(7) NOT NULL,              -- '#0071CE'
  sort_order           smallint NOT NULL DEFAULT 0
);

CREATE TABLE store_locations (
  id           integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  store_id     smallint NOT NULL REFERENCES stores(id),
  name         text NOT NULL,                         -- 'Walmart Supercenter – Plano (mock)'
  address      text NOT NULL,
  city         text NOT NULL,
  zip          char(5) NOT NULL,
  metro        text NOT NULL DEFAULT 'DFW',
  lat          numeric(9,6) NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng          numeric(9,6) NOT NULL CHECK (lng BETWEEN -180 AND 180),
  external_ref text,
  UNIQUE (store_id, external_ref)
);
CREATE INDEX store_locations_store_metro_idx ON store_locations (store_id, metro);

-- ───────────────────────── Users & auth ─────────────────────────
CREATE TABLE users (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email               citext NOT NULL UNIQUE,
  password_hash       text,                            -- argon2id; NULL for Google-only accounts
  display_name        text NOT NULL,
  home_zip            char(5),
  home_lat            numeric(9,6),
  home_lng            numeric(9,6),
  vehicle_mpg         numeric(4,1) NOT NULL DEFAULT 25 CHECK (vehicle_mpg > 0),
  fuel_cents_per_gal  integer CHECK (fuel_cents_per_gal > 0),  -- NULL → metro default
  baseline_store_id   smallint REFERENCES stores(id),          -- "where I usually shop"; savings baseline
  theme               theme_pref NOT NULL DEFAULT 'system',
  onboarded_at        timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CHECK ((home_lat IS NULL) = (home_lng IS NULL))
);

CREATE TABLE auth_identities (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider         auth_provider NOT NULL,
  provider_subject text NOT NULL,                      -- Google 'sub'
  email            citext,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_subject),
  UNIQUE (user_id, provider)
);

-- One row per refresh token. Rotation creates a new row in the same family;
-- presenting a rotated (non-current) token revokes the whole family.
CREATE TABLE sessions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  family_id          uuid NOT NULL,
  refresh_token_hash bytea NOT NULL UNIQUE,            -- sha256(token)
  expires_at         timestamptz NOT NULL,
  rotated_at         timestamptz,
  revoked_at         timestamptz,
  user_agent         text,
  ip                 inet,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_idx   ON sessions (user_id);
CREATE INDEX sessions_family_idx ON sessions (family_id);

CREATE TABLE user_stores (
  user_id               uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  store_id              smallint NOT NULL REFERENCES stores(id),
  enabled               boolean NOT NULL DEFAULT true,
  has_membership        boolean NOT NULL DEFAULT false, -- paid warehouse membership (Costco, Sam's)
  has_loyalty           boolean NOT NULL DEFAULT true,  -- free loyalty card; member prices count by default
  preferred_location_id integer REFERENCES store_locations(id),
  PRIMARY KEY (user_id, store_id)
);

-- ───────────────────────── Catalog ─────────────────────────
CREATE TABLE categories (
  id         smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  parent_id  smallint REFERENCES categories(id),
  slug       text NOT NULL UNIQUE,
  name       text NOT NULL,
  icon       text,
  sort_order smallint NOT NULL DEFAULT 0
);

-- Canonical, brand-agnostic comparable item ("Whole Milk", "Large Eggs",
-- "Bananas"). Lists point here; store_items match to here.
CREATE TABLE products (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug             text NOT NULL UNIQUE,
  name             text NOT NULL,
  category_id      smallint NOT NULL REFERENCES categories(id),
  dimension        unit_dimension NOT NULL,
  display_unit     unit_code NOT NULL,       -- unit price shown "per <display_unit>"
  default_quantity numeric(10,3) NOT NULL CHECK (default_quantity > 0),
  default_unit     unit_code NOT NULL,       -- what "1 × milk" on a list means (1 gal)
  avg_each_grams   numeric(10,2) CHECK (avg_each_grams > 0), -- bridges count↔mass (produce)
  attributes       jsonb NOT NULL DEFAULT '{}'::jsonb,       -- {"organic":true,"fat":"whole"}
  search           tsvector GENERATED ALWAYS AS (to_tsvector('english', name)) STORED,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (unit_dim(display_unit) = dimension),
  CHECK (unit_dim(default_unit) = dimension
         OR (avg_each_grams IS NOT NULL AND dimension IN ('mass','count')
             AND unit_dim(default_unit) IN ('mass','count')))
);
CREATE INDEX products_category_idx ON products (category_id);
CREATE INDEX products_search_idx   ON products USING gin (search);
CREATE INDEX products_name_trgm    ON products USING gin (name gin_trgm_ops);

-- Free-text synonyms used by import and the matcher ("2% milk", "reduced fat milk").
CREATE TABLE product_aliases (
  id         integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  alias      text NOT NULL,
  source     text NOT NULL DEFAULT 'seed' CHECK (source IN ('seed','user','import'))
);
CREATE UNIQUE INDEX product_aliases_alias_uq ON product_aliases (lower(alias));
CREATE INDEX product_aliases_trgm ON product_aliases USING gin (alias gin_trgm_ops);

-- A specific purchasable package at a chain. Unit normalization lives here.
-- "12 × 12 fl oz" → pack_count 12, unit_quantity 12, unit fl_oz, base_quantity 4258.59 ml
CREATE TABLE store_items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id         smallint NOT NULL REFERENCES stores(id),
  product_id       uuid REFERENCES products(id),     -- NULL = unmatched (review queue)
  sku              text NOT NULL,
  upc              varchar(14),
  title            text NOT NULL,                    -- raw provider title
  brand            text,
  is_store_brand   boolean NOT NULL DEFAULT false,
  pack_count       integer NOT NULL DEFAULT 1 CHECK (pack_count > 0),
  unit_quantity    numeric(12,4) NOT NULL CHECK (unit_quantity > 0),
  unit             unit_code NOT NULL,
  base_quantity    numeric(16,4) GENERATED ALWAYS AS (pack_count * unit_quantity * unit_factor(unit)) STORED,
  pricing_basis    pricing_basis NOT NULL DEFAULT 'per_package', -- per_weight: price is per 1 <unit>
  match_method     match_method,
  match_confidence numeric(4,3) CHECK (match_confidence BETWEEN 0 AND 1),
  match_reviewed   boolean NOT NULL DEFAULT false,
  active           boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_id, sku),
  CHECK (pricing_basis = 'per_package' OR (pack_count = 1 AND unit_quantity = 1 AND unit_dim(unit) = 'mass')),
  CHECK ((product_id IS NULL) = (match_method IS NULL))
);
CREATE INDEX store_items_product_idx ON store_items (product_id) WHERE active;
CREATE INDEX store_items_upc_idx     ON store_items (upc) WHERE upc IS NOT NULL;

-- Unit dimension of a store item must be compatible with its product.
CREATE FUNCTION store_items_dimension_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p products%ROWTYPE;
BEGIN
  IF NEW.product_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO p FROM products WHERE id = NEW.product_id;
  IF unit_dim(NEW.unit) = p.dimension THEN RETURN NEW; END IF;
  IF p.avg_each_grams IS NOT NULL
     AND p.dimension IN ('mass','count') AND unit_dim(NEW.unit) IN ('mass','count') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'unit % (%) incompatible with product % (%)',
    NEW.unit, unit_dim(NEW.unit), p.slug, p.dimension USING ERRCODE = 'check_violation';
END $$;
CREATE TRIGGER store_items_dimension_guard
  BEFORE INSERT OR UPDATE OF unit, product_id ON store_items
  FOR EACH ROW EXECUTE FUNCTION store_items_dimension_guard();

-- ───────────────────────── Prices ─────────────────────────
-- Price *periods*, not daily rows: one row per contiguous span at one price.
-- Ingestion extends the open period when an observation matches, else closes
-- it and opens a new one. Current price: upper_inf(valid_during).
CREATE TABLE price_points (
  id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  store_item_id         uuid NOT NULL REFERENCES store_items(id) ON DELETE CASCADE,
  metro                 text NOT NULL DEFAULT 'DFW',
  store_location_id     integer REFERENCES store_locations(id), -- NULL = metro-wide
  valid_during          daterange NOT NULL CHECK (NOT isempty(valid_during)),
  regular_price_cents   integer NOT NULL CHECK (regular_price_cents > 0),
  sale_price_cents      integer CHECK (sale_price_cents > 0),
  effective_price_cents integer GENERATED ALWAYS AS (COALESCE(sale_price_cents, regular_price_cents)) STORED,
  promo_type            promo_type NOT NULL DEFAULT 'none',
  promo_label           text,                          -- '2 for $5', 'Circle deal'
  min_qty               smallint NOT NULL DEFAULT 1 CHECK (min_qty >= 1),
  member_only           boolean NOT NULL DEFAULT false, -- sale needs paid membership or loyalty card;
                                                        -- non-members pay regular_price_cents
  source                text NOT NULL,                 -- provider id: 'mock'
  observed_at           timestamptz NOT NULL DEFAULT now(),
  CHECK (sale_price_cents IS NULL OR sale_price_cents < regular_price_cents),
  CHECK ((sale_price_cents IS NULL) = (promo_type = 'none')),
  CONSTRAINT price_points_no_overlap EXCLUDE USING gist (
    store_item_id WITH =,
    metro WITH =,
    (COALESCE(store_location_id, 0)) WITH =,
    valid_during WITH &&
  )
);
CREATE INDEX price_points_item_from_idx ON price_points (store_item_id, lower(valid_during) DESC);
CREATE INDEX price_points_current_idx   ON price_points (store_item_id) WHERE upper_inf(valid_during);

CREATE TABLE provider_sync_runs (
  id                   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  provider             text NOT NULL,
  started_at           timestamptz NOT NULL DEFAULT now(),
  finished_at          timestamptz,
  status               text NOT NULL DEFAULT 'running' CHECK (status IN ('running','ok','failed')),
  items_upserted       integer NOT NULL DEFAULT 0,
  price_points_written integer NOT NULL DEFAULT 0,
  unmatched_items      integer NOT NULL DEFAULT 0,
  error                text,
  kind                 text NOT NULL DEFAULT 'full' CHECK (kind IN ('full','daily')),
  as_of                date                           -- market date this run brought prices up to
);

-- ───────────────────────── Lists ─────────────────────────
CREATE TABLE grocery_lists (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid REFERENCES users(id) ON DELETE CASCADE,  -- NULL = system template
  name        text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  description text,
  is_template boolean NOT NULL DEFAULT false,
  archived_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (user_id IS NOT NULL OR is_template)
);
CREATE INDEX grocery_lists_user_idx ON grocery_lists (user_id, is_template) WHERE archived_at IS NULL;

CREATE TABLE list_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id       uuid NOT NULL REFERENCES grocery_lists(id) ON DELETE CASCADE,
  position      integer NOT NULL,
  raw_text      text NOT NULL CHECK (length(raw_text) BETWEEN 1 AND 200),
  product_id    uuid REFERENCES products(id),     -- NULL = unmatched free text (not priced)
  quantity      numeric(10,3) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit          unit_code,                        -- NULL → quantity × product default size
  match_mode    match_mode NOT NULL DEFAULT 'any',
  brand         text,
  store_item_id uuid REFERENCES store_items(id),
  category_id   smallint REFERENCES categories(id), -- override; else product's category
  checked       boolean NOT NULL DEFAULT false,
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (match_mode <> 'brand'      OR brand IS NOT NULL),
  CHECK (match_mode <> 'exact_item' OR store_item_id IS NOT NULL),
  CHECK (unit IS NULL OR product_id IS NOT NULL)
);
CREATE INDEX list_items_list_pos_idx ON list_items (list_id, position);

-- ───────────────────────── Alerts ─────────────────────────
CREATE TABLE price_alerts (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id         uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  kind               alert_kind NOT NULL,
  target_cents       integer CHECK (target_cents > 0),  -- per product.display_unit
  active             boolean NOT NULL DEFAULT true,
  last_triggered_at  timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, product_id, kind),
  CHECK ((kind = 'target_price') = (target_cents IS NOT NULL))
);

CREATE TABLE notifications (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  alert_id   uuid REFERENCES price_alerts(id) ON DELETE SET NULL,
  kind       text NOT NULL,                 -- 'historic_low' | 'target_price'
  payload    jsonb NOT NULL,                -- product, store, prices, prior low
  dedupe_key text NOT NULL,                 -- alert_id + price_point_id
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at    timestamptz,
  UNIQUE (user_id, dedupe_key)
);
CREATE INDEX notifications_unread_idx ON notifications (user_id, created_at DESC) WHERE read_at IS NULL;

-- ───────────────────────── Trips (savings ledger) ─────────────────────────
-- A trip is a plan the user committed to ("I shopped this"). Dashboard reads only trips.
CREATE TABLE trips (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  list_id              uuid REFERENCES grocery_lists(id) ON DELETE SET NULL,
  plan_type            plan_type NOT NULL,
  store_ids            smallint[] NOT NULL CHECK (cardinality(store_ids) >= 1),
  baseline_store_id    smallint NOT NULL REFERENCES stores(id),
  items_total_cents    integer NOT NULL CHECK (items_total_cents >= 0),
  fuel_cost_cents      integer NOT NULL DEFAULT 0 CHECK (fuel_cost_cents >= 0),
  distance_miles       numeric(7,2) NOT NULL DEFAULT 0,
  baseline_total_cents integer NOT NULL CHECK (baseline_total_cents >= 0),
  savings_cents        integer GENERATED ALWAYS AS
                         (baseline_total_cents - items_total_cents - fuel_cost_cents) STORED,
  price_as_of          date NOT NULL,
  shopped_on           date NOT NULL,
  plan                 jsonb NOT NULL,      -- immutable snapshot of the plan shown to the user
  created_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX trips_user_date_idx ON trips (user_id, shopped_on DESC);

CREATE TABLE trip_items (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id             uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  product_id          uuid REFERENCES products(id),
  store_item_id       uuid REFERENCES store_items(id),
  store_id            smallint NOT NULL REFERENCES stores(id),
  category_id         smallint REFERENCES categories(id),
  packages            integer CHECK (packages > 0),            -- NULL for per_weight items
  base_quantity       numeric(16,4) NOT NULL CHECK (base_quantity > 0), -- g / ml / ea bought
  line_total_cents    integer NOT NULL CHECK (line_total_cents >= 0),
  baseline_line_cents integer NOT NULL CHECK (baseline_line_cents >= 0)
);
CREATE INDEX trip_items_trip_idx ON trip_items (trip_id);
