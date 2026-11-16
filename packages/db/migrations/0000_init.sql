-- Custom (hand-written): extensions. See SPEC Appendix A / docs/schema.sql.
CREATE EXTENSION IF NOT EXISTS citext;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS btree_gist;--> statement-breakpoint
CREATE TYPE "public"."alert_kind" AS ENUM('historic_low', 'target_price');--> statement-breakpoint
CREATE TYPE "public"."auth_provider" AS ENUM('google');--> statement-breakpoint
CREATE TYPE "public"."match_method" AS ENUM('upc', 'rule', 'fuzzy', 'manual');--> statement-breakpoint
CREATE TYPE "public"."match_mode" AS ENUM('any', 'brand', 'exact_item');--> statement-breakpoint
CREATE TYPE "public"."plan_type" AS ENUM('single', 'multi');--> statement-breakpoint
CREATE TYPE "public"."pricing_basis" AS ENUM('per_package', 'per_weight');--> statement-breakpoint
CREATE TYPE "public"."promo_type" AS ENUM('none', 'sale', 'clearance', 'member', 'multi_buy');--> statement-breakpoint
CREATE TYPE "public"."theme_pref" AS ENUM('system', 'light', 'dark');--> statement-breakpoint
CREATE TYPE "public"."unit_code" AS ENUM('g', 'kg', 'oz', 'lb', 'ml', 'l', 'fl_oz', 'pt', 'qt', 'gal', 'ea', 'dozen');--> statement-breakpoint
CREATE TYPE "public"."unit_dimension" AS ENUM('mass', 'volume', 'count');--> statement-breakpoint
-- Custom (hand-written): unit functions. MUST match packages/core/src/units/table.ts (parity test).
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
$$;--> statement-breakpoint
CREATE FUNCTION unit_dim(u unit_code) RETURNS unit_dimension
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE
    WHEN u IN ('g','kg','oz','lb') THEN 'mass'
    WHEN u IN ('ml','l','fl_oz','pt','qt','gal') THEN 'volume'
    ELSE 'count'
  END::unit_dimension
$$;--> statement-breakpoint
CREATE TABLE "auth_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" "auth_provider" NOT NULL,
	"provider_subject" text NOT NULL,
	"email" "citext",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_identities_provider_provider_subject_key" UNIQUE("provider","provider_subject"),
	CONSTRAINT "auth_identities_user_id_provider_key" UNIQUE("user_id","provider")
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" smallint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "categories_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 32767 START WITH 1 CACHE 1),
	"parent_id" smallint,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"icon" text,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	CONSTRAINT "categories_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "grocery_lists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"name" text NOT NULL,
	"description" text,
	"is_template" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "grocery_lists_name_check" CHECK (length("grocery_lists"."name") BETWEEN 1 AND 120),
	CONSTRAINT "grocery_lists_owner_check" CHECK ("grocery_lists"."user_id" IS NOT NULL OR "grocery_lists"."is_template")
);
--> statement-breakpoint
CREATE TABLE "list_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"list_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"raw_text" text NOT NULL,
	"product_id" uuid,
	"quantity" numeric(10, 3) DEFAULT 1 NOT NULL,
	"unit" "unit_code",
	"match_mode" "match_mode" DEFAULT 'any' NOT NULL,
	"brand" text,
	"store_item_id" uuid,
	"category_id" smallint,
	"checked" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "list_items_raw_text_check" CHECK (length("list_items"."raw_text") BETWEEN 1 AND 200),
	CONSTRAINT "list_items_quantity_check" CHECK ("list_items"."quantity" > 0),
	CONSTRAINT "list_items_brand_check" CHECK ("list_items"."match_mode" <> 'brand' OR "list_items"."brand" IS NOT NULL),
	CONSTRAINT "list_items_exact_item_check" CHECK ("list_items"."match_mode" <> 'exact_item' OR "list_items"."store_item_id" IS NOT NULL),
	CONSTRAINT "list_items_unit_check" CHECK ("list_items"."unit" IS NULL OR "list_items"."product_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"alert_id" uuid,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"dedupe_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone,
	CONSTRAINT "notifications_user_id_dedupe_key_key" UNIQUE("user_id","dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "price_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"kind" "alert_kind" NOT NULL,
	"target_cents" integer,
	"active" boolean DEFAULT true NOT NULL,
	"last_triggered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "price_alerts_user_id_product_id_kind_key" UNIQUE("user_id","product_id","kind"),
	CONSTRAINT "price_alerts_target_cents_check" CHECK ("price_alerts"."target_cents" > 0),
	CONSTRAINT "price_alerts_kind_target_check" CHECK (("price_alerts"."kind" = 'target_price') = ("price_alerts"."target_cents" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "price_points" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "price_points_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"store_item_id" uuid NOT NULL,
	"metro" text DEFAULT 'DFW' NOT NULL,
	"store_location_id" integer,
	"valid_during" daterange NOT NULL,
	"regular_price_cents" integer NOT NULL,
	"sale_price_cents" integer,
	"effective_price_cents" integer GENERATED ALWAYS AS (COALESCE(sale_price_cents, regular_price_cents)) STORED,
	"promo_type" "promo_type" DEFAULT 'none' NOT NULL,
	"promo_label" text,
	"min_qty" smallint DEFAULT 1 NOT NULL,
	"member_only" boolean DEFAULT false NOT NULL,
	"source" text NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "price_points_valid_during_check" CHECK (NOT isempty("price_points"."valid_during")),
	CONSTRAINT "price_points_regular_price_cents_check" CHECK ("price_points"."regular_price_cents" > 0),
	CONSTRAINT "price_points_sale_price_cents_check" CHECK ("price_points"."sale_price_cents" > 0),
	CONSTRAINT "price_points_min_qty_check" CHECK ("price_points"."min_qty" >= 1),
	CONSTRAINT "price_points_sale_lt_regular_check" CHECK ("price_points"."sale_price_cents" IS NULL OR "price_points"."sale_price_cents" < "price_points"."regular_price_cents"),
	CONSTRAINT "price_points_promo_check" CHECK (("price_points"."sale_price_cents" IS NULL) = ("price_points"."promo_type" = 'none'))
);
--> statement-breakpoint
CREATE TABLE "product_aliases" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "product_aliases_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"product_id" uuid NOT NULL,
	"alias" text NOT NULL,
	"source" text DEFAULT 'seed' NOT NULL,
	CONSTRAINT "product_aliases_source_check" CHECK ("product_aliases"."source" IN ('seed','user','import'))
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"category_id" smallint NOT NULL,
	"dimension" "unit_dimension" NOT NULL,
	"display_unit" "unit_code" NOT NULL,
	"default_quantity" numeric(10, 3) NOT NULL,
	"default_unit" "unit_code" NOT NULL,
	"avg_each_grams" numeric(10, 2),
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"search" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', name)) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_slug_unique" UNIQUE("slug"),
	CONSTRAINT "products_default_quantity_check" CHECK ("products"."default_quantity" > 0),
	CONSTRAINT "products_avg_each_grams_check" CHECK ("products"."avg_each_grams" > 0),
	CONSTRAINT "products_display_unit_check" CHECK (unit_dim("products"."display_unit") = "products"."dimension"),
	CONSTRAINT "products_default_unit_check" CHECK (unit_dim("products"."default_unit") = "products"."dimension" OR ("products"."avg_each_grams" IS NOT NULL AND "products"."dimension" IN ('mass','count') AND unit_dim("products"."default_unit") IN ('mass','count')))
);
--> statement-breakpoint
CREATE TABLE "provider_sync_runs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "provider_sync_runs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"provider" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" text DEFAULT 'running' NOT NULL,
	"items_upserted" integer DEFAULT 0 NOT NULL,
	"price_points_written" integer DEFAULT 0 NOT NULL,
	"unmatched_items" integer DEFAULT 0 NOT NULL,
	"error" text,
	CONSTRAINT "provider_sync_runs_status_check" CHECK ("provider_sync_runs"."status" IN ('running','ok','failed'))
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"family_id" uuid NOT NULL,
	"refresh_token_hash" "bytea" NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"rotated_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"user_agent" text,
	"ip" "inet",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_refresh_token_hash_unique" UNIQUE("refresh_token_hash")
);
--> statement-breakpoint
CREATE TABLE "store_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" smallint NOT NULL,
	"product_id" uuid,
	"sku" text NOT NULL,
	"upc" varchar(14),
	"title" text NOT NULL,
	"brand" text,
	"is_store_brand" boolean DEFAULT false NOT NULL,
	"pack_count" integer DEFAULT 1 NOT NULL,
	"unit_quantity" numeric(12, 4) NOT NULL,
	"unit" "unit_code" NOT NULL,
	"base_quantity" numeric(16, 4) GENERATED ALWAYS AS (pack_count * unit_quantity * unit_factor(unit)) STORED,
	"pricing_basis" "pricing_basis" DEFAULT 'per_package' NOT NULL,
	"match_method" "match_method",
	"match_confidence" numeric(4, 3),
	"match_reviewed" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "store_items_store_id_sku_key" UNIQUE("store_id","sku"),
	CONSTRAINT "store_items_pack_count_check" CHECK ("store_items"."pack_count" > 0),
	CONSTRAINT "store_items_unit_quantity_check" CHECK ("store_items"."unit_quantity" > 0),
	CONSTRAINT "store_items_match_confidence_check" CHECK ("store_items"."match_confidence" BETWEEN 0 AND 1),
	CONSTRAINT "store_items_per_weight_check" CHECK ("store_items"."pricing_basis" = 'per_package' OR ("store_items"."pack_count" = 1 AND "store_items"."unit_quantity" = 1 AND unit_dim("store_items"."unit") = 'mass')),
	CONSTRAINT "store_items_match_check" CHECK (("store_items"."product_id" IS NULL) = ("store_items"."match_method" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "store_locations" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "store_locations_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"store_id" smallint NOT NULL,
	"name" text NOT NULL,
	"address" text NOT NULL,
	"city" text NOT NULL,
	"zip" char(5) NOT NULL,
	"metro" text DEFAULT 'DFW' NOT NULL,
	"lat" numeric(9, 6) NOT NULL,
	"lng" numeric(9, 6) NOT NULL,
	"external_ref" text,
	CONSTRAINT "store_locations_store_id_external_ref_key" UNIQUE("store_id","external_ref"),
	CONSTRAINT "store_locations_lat_check" CHECK ("store_locations"."lat" BETWEEN -90 AND 90),
	CONSTRAINT "store_locations_lng_check" CHECK ("store_locations"."lng" BETWEEN -180 AND 180)
);
--> statement-breakpoint
CREATE TABLE "stores" (
	"id" smallint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "stores_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 32767 START WITH 1 CACHE 1),
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"requires_membership" boolean DEFAULT false NOT NULL,
	"membership_fee_cents" integer,
	"loyalty_program" text,
	"brand_color" char(7) NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	CONSTRAINT "stores_slug_unique" UNIQUE("slug"),
	CONSTRAINT "stores_membership_fee_cents_check" CHECK ("stores"."membership_fee_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "trip_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trip_id" uuid NOT NULL,
	"product_id" uuid,
	"store_item_id" uuid,
	"store_id" smallint NOT NULL,
	"category_id" smallint,
	"packages" integer,
	"base_quantity" numeric(16, 4) NOT NULL,
	"line_total_cents" integer NOT NULL,
	"baseline_line_cents" integer NOT NULL,
	CONSTRAINT "trip_items_packages_check" CHECK ("trip_items"."packages" > 0),
	CONSTRAINT "trip_items_base_quantity_check" CHECK ("trip_items"."base_quantity" > 0),
	CONSTRAINT "trip_items_line_total_cents_check" CHECK ("trip_items"."line_total_cents" >= 0),
	CONSTRAINT "trip_items_baseline_line_cents_check" CHECK ("trip_items"."baseline_line_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "trips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"list_id" uuid,
	"plan_type" "plan_type" NOT NULL,
	"store_ids" smallint[] NOT NULL,
	"baseline_store_id" smallint NOT NULL,
	"items_total_cents" integer NOT NULL,
	"fuel_cost_cents" integer DEFAULT 0 NOT NULL,
	"distance_miles" numeric(7, 2) DEFAULT 0 NOT NULL,
	"baseline_total_cents" integer NOT NULL,
	"savings_cents" integer GENERATED ALWAYS AS (baseline_total_cents - items_total_cents - fuel_cost_cents) STORED,
	"price_as_of" date NOT NULL,
	"shopped_on" date NOT NULL,
	"plan" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trips_store_ids_check" CHECK (cardinality("trips"."store_ids") >= 1),
	CONSTRAINT "trips_items_total_cents_check" CHECK ("trips"."items_total_cents" >= 0),
	CONSTRAINT "trips_fuel_cost_cents_check" CHECK ("trips"."fuel_cost_cents" >= 0),
	CONSTRAINT "trips_baseline_total_cents_check" CHECK ("trips"."baseline_total_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "user_stores" (
	"user_id" uuid NOT NULL,
	"store_id" smallint NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"has_membership" boolean DEFAULT false NOT NULL,
	"has_loyalty" boolean DEFAULT true NOT NULL,
	"preferred_location_id" integer,
	CONSTRAINT "user_stores_user_id_store_id_pk" PRIMARY KEY("user_id","store_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" "citext" NOT NULL,
	"password_hash" text,
	"display_name" text NOT NULL,
	"home_zip" char(5),
	"home_lat" numeric(9, 6),
	"home_lng" numeric(9, 6),
	"vehicle_mpg" numeric(4, 1) DEFAULT 25 NOT NULL,
	"fuel_cents_per_gal" integer,
	"baseline_store_id" smallint,
	"theme" "theme_pref" DEFAULT 'system' NOT NULL,
	"onboarded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_vehicle_mpg_check" CHECK ("users"."vehicle_mpg" > 0),
	CONSTRAINT "users_fuel_cents_per_gal_check" CHECK ("users"."fuel_cents_per_gal" > 0),
	CONSTRAINT "users_home_latlng_check" CHECK (("users"."home_lat" IS NULL) = ("users"."home_lng" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "auth_identities" ADD CONSTRAINT "auth_identities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_id_categories_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grocery_lists" ADD CONSTRAINT "grocery_lists_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "list_items" ADD CONSTRAINT "list_items_list_id_grocery_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."grocery_lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "list_items" ADD CONSTRAINT "list_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "list_items" ADD CONSTRAINT "list_items_store_item_id_store_items_id_fk" FOREIGN KEY ("store_item_id") REFERENCES "public"."store_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "list_items" ADD CONSTRAINT "list_items_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_alert_id_price_alerts_id_fk" FOREIGN KEY ("alert_id") REFERENCES "public"."price_alerts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_alerts" ADD CONSTRAINT "price_alerts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_alerts" ADD CONSTRAINT "price_alerts_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_points" ADD CONSTRAINT "price_points_store_item_id_store_items_id_fk" FOREIGN KEY ("store_item_id") REFERENCES "public"."store_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_points" ADD CONSTRAINT "price_points_store_location_id_store_locations_id_fk" FOREIGN KEY ("store_location_id") REFERENCES "public"."store_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_aliases" ADD CONSTRAINT "product_aliases_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_items" ADD CONSTRAINT "store_items_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_items" ADD CONSTRAINT "store_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_locations" ADD CONSTRAINT "store_locations_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_items" ADD CONSTRAINT "trip_items_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_items" ADD CONSTRAINT "trip_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_items" ADD CONSTRAINT "trip_items_store_item_id_store_items_id_fk" FOREIGN KEY ("store_item_id") REFERENCES "public"."store_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_items" ADD CONSTRAINT "trip_items_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_items" ADD CONSTRAINT "trip_items_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_list_id_grocery_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."grocery_lists"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_baseline_store_id_stores_id_fk" FOREIGN KEY ("baseline_store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_stores" ADD CONSTRAINT "user_stores_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_stores" ADD CONSTRAINT "user_stores_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_stores" ADD CONSTRAINT "user_stores_preferred_location_id_store_locations_id_fk" FOREIGN KEY ("preferred_location_id") REFERENCES "public"."store_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_baseline_store_id_stores_id_fk" FOREIGN KEY ("baseline_store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "grocery_lists_user_idx" ON "grocery_lists" USING btree ("user_id","is_template") WHERE archived_at IS NULL;--> statement-breakpoint
CREATE INDEX "list_items_list_pos_idx" ON "list_items" USING btree ("list_id","position");--> statement-breakpoint
CREATE INDEX "notifications_unread_idx" ON "notifications" USING btree ("user_id",created_at DESC) WHERE read_at IS NULL;--> statement-breakpoint
CREATE INDEX "price_points_item_from_idx" ON "price_points" USING btree ("store_item_id",lower("valid_during") DESC);--> statement-breakpoint
CREATE INDEX "price_points_current_idx" ON "price_points" USING btree ("store_item_id") WHERE upper_inf(valid_during);--> statement-breakpoint
CREATE UNIQUE INDEX "product_aliases_alias_uq" ON "product_aliases" USING btree (lower("alias"));--> statement-breakpoint
CREATE INDEX "product_aliases_trgm" ON "product_aliases" USING gin ("alias" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "products_category_idx" ON "products" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "products_search_idx" ON "products" USING gin ("search");--> statement-breakpoint
CREATE INDEX "products_name_trgm" ON "products" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_family_idx" ON "sessions" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "store_items_product_idx" ON "store_items" USING btree ("product_id") WHERE active;--> statement-breakpoint
CREATE INDEX "store_items_upc_idx" ON "store_items" USING btree ("upc") WHERE upc IS NOT NULL;--> statement-breakpoint
CREATE INDEX "store_locations_store_metro_idx" ON "store_locations" USING btree ("store_id","metro");--> statement-breakpoint
CREATE INDEX "trip_items_trip_idx" ON "trip_items" USING btree ("trip_id");--> statement-breakpoint
CREATE INDEX "trips_user_date_idx" ON "trips" USING btree ("user_id",shopped_on DESC);--> statement-breakpoint
-- Custom (hand-written): store item ↔ product unit-dimension guard.
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
END $$;--> statement-breakpoint
CREATE TRIGGER store_items_dimension_guard
  BEFORE INSERT OR UPDATE OF unit, product_id ON store_items
  FOR EACH ROW EXECUTE FUNCTION store_items_dimension_guard();--> statement-breakpoint
-- Custom (hand-written): no overlapping price periods per item / metro / location.
ALTER TABLE price_points ADD CONSTRAINT price_points_no_overlap EXCLUDE USING gist (
  store_item_id WITH =,
  metro WITH =,
  (COALESCE(store_location_id, 0)) WITH =,
  valid_during WITH &&
);
