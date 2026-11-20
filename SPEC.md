# Smart Grocery Saver — Product & Technical Spec

**Status:** Phase 0 draft for review (rev 11: Phases 1–7 delivered; see §7 "Delivered" notes for deviations) · **Date:** 2026-11-16 · **Launch market:** Dallas–Fort Worth (DFW)

Smart Grocery Saver helps budget-conscious families cut grocery spend by **10–25%**. It compares prices across
**Walmart, Costco, Sam's Club, Target, Kroger, H-E-B, Aldi, Tom Thumb, Sprouts and Trader Joe's**, and decides whether one store or a multi-store run
is worth the drive.

Open questions and assumptions are in [`OPEN_QUESTIONS.md`](./OPEN_QUESTIONS.md). Where this spec makes a call that is
really yours to make, it is marked **[A-n]** (assumption) or **[Q-n]** (open question) with the same number used there.

---

## 1. MVP scope

### 1.1 In scope (Phases 1–7)

| Area | MVP capability |
|---|---|
| Accounts | Email/password sign-up and login. Google OAuth, with a local mock consent screen when credentials are absent. Refresh-token sessions and protected routes. Onboarding: ZIP, stores (nearest pre-selected), memberships and loyalty cards, vehicle MPG, "usual store". |
| Catalog | ≥150 canonical products in ~14 categories. Each is matched to package-level store items across the 10 chains (coverage varies by chain, §2.6). Search by name or alias. |
| Lists | Create, rename, archive and duplicate lists. Add items by search or free text. Quantity + unit, brand preference, check off, reorder. Category grouping. System and user templates. CSV and pasted-text import with match preview. |
| Comparison | Per-item and per-store cost for a list. Normalized unit prices ($/oz, $/fl oz, $/lb, $/ea). Cheapest store per item and cheapest single store highlighted. % savings vs. baseline store. Missing-item and approximate-match flags. |
| History | 12 months of price periods per store item. 30/90/365-day charts per product (one line per store). Historic-low badge. Historic-low and target-price alerts delivered in-app. |
| Dashboard | KPI cards (total saved, avg % saved, trips, best store). Savings over time, by store, by category. CSV and PDF export. |
| Optimizer | Best single store vs. best 2/3-store plan. Plans include distance, fuel cost and (optionally) time cost. "Is the extra stop worth it?" verdict. Commit a plan as a trip for the savings ledger. |
| Platform | Mobile-first responsive web app (360px+). Dark mode (system/light/dark). WCAG 2.2 AA on critical flows. |

### 1.2 Out of scope for MVP (roadmap, §8)
Real price providers and scraping, native apps, pantry tracking, deal/coupon engine, budgets, meal planning, AI features,
premium tier, household sharing, email/push notifications, password reset by email **[Q-6]**, store aisle layout,
receipt scanning, real driving directions (straight-line × circuity factor instead **[A-9]**).

### 1.3 Non-functional targets
- **Performance (seeded data, laptop, warm DB):** a 50-item list's comparison returns in under 300 ms (p95). The optimizer runs in under 500 ms with 10 stores and max 3 stops. Product history (365d) returns in under 150 ms.
- **Correctness:** all money is integer cents. Rounding is half-even, applied only to final line totals. Unit math is in base units (g, ml, ea).
- **Determinism:** seeded data is reproducible from `SEED` + `SEED_ANCHOR_DATE`. Tests pin both.
- **Security:** argon2id passwords. httpOnly SameSite=Lax cookies. CSRF header check. Rate-limited auth. Zod validation on every input. Helmet. No secrets in the repo.
- **Accessibility:** axe-core reports zero serious/critical violations on Playwright-covered screens. Colour is never the only signal (cheapest = colour + icon + text).

---

## 2. Domain model: products, matching and units

This is the core of the product, so the schema is built around three layers:

```
products (canonical, brand-agnostic)      "Whole Milk"   dimension=volume  display_unit=fl_oz  default=1 gal
   ▲ product_id                ▲ product_id
store_items (package at a chain)          Kroger "Kroger Whole Milk 1 gal"      1 × 1 gal      = 3785.41 ml
   │                                      Costco "Kirkland Whole Milk 2 × 1 gal" 2 × 1 gal     = 7570.82 ml
   ▼ store_item_id
price_points (price periods)              [2026-11-01, 2026-11-08)  regular 389  sale 329  'Weekly ad'
```

Users put **products** on lists ("whole milk, 2 gal"). The app finds every active **store item** matched to that
product and prices it from the current **price point**.

### 2.1 Units

| Dimension | Base | Accepted units (factor to base) |
|---|---|---|
| mass | g | g 1 · kg 1000 · oz 28.349523125 · lb 453.59237 |
| volume | ml | ml 1 · l 1000 · fl_oz 29.5735295625 · pt 473.176473 · qt 946.352946 · gal 3785.411784 |
| count | ea | ea 1 · dozen 12 |

- **Base quantity** of a package = `pack_count × unit_quantity × factor(unit)`. It is a generated column in Postgres. `packages/core` computes the same thing for the client, and a parity test keeps the two factor tables identical.
- **Unit price** = `effective_price_cents / base_quantity`, then converted to the product's `display_unit` for display. Milk shows $/fl oz *and* $/gal; meat shows $/lb; cereal $/oz; eggs $/ea.
- **`oz` vs `fl_oz` are never interchangeable.** A product's dimension is fixed. A store item must match it, and a DB trigger enforces this.
- **Count↔mass bridging:** produce sold both "each" and "per lb" (avocados, lemons, bananas) carries `avg_each_grams`. Comparisons across the bridge are allowed but flagged `approximate: true` in the API and shown as "≈" in the UI.
- **Per-weight pricing:** loose meat and produce priced per lb use `pricing_basis = per_weight`. The price is per 1 `unit`, and there is no package rounding.
- **Multi-packs:** "12 × 12 fl oz", "6 pk 16.9 oz", "2/16 oz", "Twin pack 2 × 64 fl oz" become `pack_count` + `unit_quantity`. `oz` in a beverage title is interpreted as `fl_oz` only when the product's dimension is volume.
- **Size parser** (`core/units/parseSize`): table-driven. ≥60 fixtures are required, covering the formats above plus `"1.5 lb"`, `"dozen"`, `"18 ct"`, `"0.5 gal"`, `"750 mL"`, `"3 lb bag"`, `"Family Size 19.3 oz"`, `"approx. 2.25 lb"`. Unparseable sizes are rejected to the review queue, never guessed.

### 2.2 Quantity on a list and "what you actually pay"
A list item asks for `quantity` of `unit`. If `unit` is null, it means `quantity × product.default_quantity default_unit`, so "1 milk" = 1 gal.

For each store, the comparison picks the cheapest way to **cover** the requested base quantity with that store's
eligible packages:

- `per_package`: for each eligible item, `packages = ceil(need / base_quantity)` and `cost = packages × price` (honouring `min_qty` on multi-buy deals). The store's line is the minimum-cost option. Ties go to less overbuy, then to the national brand only if `match_mode = brand`.
- `per_weight`: `cost = need_in_unit × price`.
- The response shows both **line cost** (what you pay) and **unit price** (value). This keeps Costco honest. Its 2-gal pack may have the best unit price but cost more if you need one gallon. **[A-5]**
- Overbuy (bought − needed) is returned so the UI can show "+1 gal extra".

### 2.3 Eligibility (which store items can satisfy a list item)
| `match_mode` | Eligible store items |
|---|---|
| `any` (default) | all active items matched to the product, any brand |
| `brand` | items whose `brand` equals the list item's `brand` (case-insensitive), or store items marked equivalent by alias rule |
| `exact_item` | only the pinned `store_item_id` (that one store) |

**Warehouse clubs (Costco, Sam's) [Q-3, decided].** A club is never greyed out. If the user has a membership
(`user_stores.has_membership`), the club counts in comparisons, totals and plans exactly like any other store. If
they don't, the club is left out of comparisons and plans entirely, with no greyed-out column and no "needs
membership" badge. It stays listed in onboarding and Settings with an "I'm a member" toggle. Disabled stores are
always excluded.

A store with no eligible item gets a line marked `missing`. Its total is flagged "incomplete" and it is never shown
as the cheapest store for the full list. The UI offers "cheapest with N items missing" as a secondary sort.

**Member and loyalty prices.** A price period with `member_only = true` gives its `sale_price_cents` only to users
who qualify. Paid-membership stores qualify through `has_membership`. Stores with a free `loyalty_program` qualify
through `user_stores.has_loyalty`, which **defaults to true**. Two chains have one:
- **Tom Thumb** ("Tom Thumb for U").
- **Kroger** ("Kroger Plus Card"). Its card prices and digital coupons are both member-only periods.

So member prices at both count unless the user turns the card off in Settings. Everyone else pays
`regular_price_cents` for that period. The UI labels these prices with the program name ("for U price", "Card
price") so users know a card is needed.

### 2.4 Product matching pipeline (ingestion)
`PriceProvider` → **normalize** (parse size, brand, store-brand flag) → **match** → upsert `store_items` → write price
period → evaluate alerts.

Matching stops at the first stage that succeeds:
1. **UPC**: exact `upc` already matched elsewhere → same product (confidence 1.0).
2. **Rule**: a provider-supplied or curated mapping, `sku → product slug` (confidence 0.95). The mock provider ships with these.
3. **Fuzzy**: `pg_trgm` similarity of the normalized title against `products.name` and `product_aliases`, with a dimension-compatibility filter. A match is accepted only if similarity ≥ 0.55 **and** it beats the runner-up by ≥ 0.10. Otherwise …
4. **Review queue**: `product_id = NULL`. The item is counted in `provider_sync_runs.unmatched_items`. MVP review is a CLI (`pnpm match:review`), and the admin UI is roadmap.

User-facing import (CSV/text) reuses stages 3–4 against products, so a pasted "2% milk" goes through the same path.

### 2.5 Price periods
Prices are stored as **periods** (`daterange [from, to)`), not daily rows:
- A Postgres exclusion constraint prevents overlapping periods for the same item, metro and location (verified in Phase 0 against PG16).
- Ingesting an observation extends the open period if the price is unchanged. Otherwise it closes the open period at `asOf` and opens a new one.
- Current price = the period where `upper_inf(valid_during)`. Price on date *d* = the period containing *d*.
- Charts are served as step series, one point per period boundary. The client renders `stepAfter`.
- All price dates are calendar dates in `America/Chicago` **[A-7]**.
- Prices are metro-wide in MVP (`store_location_id = NULL`). The column exists so per-store pricing needs no migration **[A-4]**.

### 2.6 PriceProvider contract (`packages/pricing/src/provider.ts`)
```ts
export interface PriceProvider {
  readonly id: string;                                   // 'mock'
  listStores(metro: Metro): Promise<ProviderStore[]>;
  listLocations(store: StoreSlug, metro: Metro): Promise<ProviderLocation[]>;
  listItems(store: StoreSlug, page?: Cursor): Promise<Page<ProviderItem>>;   // raw title, size text, upc, brand
  getPrices(q: { store: StoreSlug; metro: Metro; asOf: IsoDate; skus?: string[] }): Promise<ProviderPrice[]>;
  getPriceHistory?(q: { store: StoreSlug; sku: string; from: IsoDate; to: IsoDate }): Promise<ProviderPrice[]>;
  health(): Promise<{ ok: boolean; detail?: string }>;
}
```
Providers return **raw** data such as size strings and titles. Normalization and matching are ours, which keeps real
providers plug-compatible. `MockPriceProvider` is deterministic, using a seeded PRNG and an anchor date, and it is the
**only** path the seed uses to load prices. The seed therefore exercises the real ingestion code.

**Mock data calibration** (the seed must reproduce these; Phase 1 tests assert the ranges):

| Chain | Regular-price index* | Assortment coverage | Promo behaviour |
|---|---|---|---|
| Aldi | 0.80–0.85 | ~70%, mostly store brand | rare sales, "Aldi Finds" |
| Walmart | 0.86–0.90 | ~98% | rollbacks, ~5% of items/week |
| Costco | 0.78–0.84 per unit | ~55%, bulk packs only | monthly member coupons |
| Sam's Club | 0.80–0.86 per unit | ~55%, bulk packs only | monthly instant savings |
| H-E-B | 0.90–0.95 | ~92% | weekly ad (Wed) |
| Kroger | 1.00 (reference) | ~95% | weekly ad (Wed–Tue), 20–35% off, ~12% of items; most ad prices and all digital coupons are **member-only** card prices |
| Target | 1.03–1.08 | ~85% | weekly Circle deals (Sun–Sat) |
| Tom Thumb | 1.08–1.12 | ~93% | weekly ad (Wed–Tue); ~18% of items have **member-only** "for U" prices 25–40% off |
| Sprouts | produce 0.88–0.94; other 1.04–1.10 | ~65%, produce/bulk/natural-heavy | weekly ad (Wed–Tue), **Wednesdays overlap** old and new ads |
| Trader Joe's | 0.90–0.95 | ~40%, almost all store brand | no weekly sales; stable prices; few seasonal swings |

**Store brands (Q-9, decided):** seeded items use each chain's real store-brand names with mock prices:
- Walmart: Great Value
- Costco: Kirkland Signature
- Sam's Club: Member's Mark
- Target: Good & Gather, Market Pantry
- Kroger: Kroger, Simple Truth
- H-E-B: H-E-B, Hill Country Fare
- Aldi: Friendly Farms, Simply Nature, Millville
- Tom Thumb: Signature SELECT, O Organics
- Sprouts: Sprouts
- Trader Joe's: Trader Joe's

National-brand items appear alongside them so that `match_mode = brand` has real cases to test.

\*Index of a chain's per-unit regular price vs. Kroger for the same product. The ranges are estimates for mock data, not research.

Chain-specific notes:
- **Sprouts:** the Wednesday double-ad day is two promo sources on one date. The generator resolves it to one period per item and day (the lower price wins), so the no-overlap constraint holds.
- **Trader Joe's:** with ~40% coverage it is often marked incomplete for a full list, and its store-brand items rarely satisfy `match_mode = brand`. It mostly competes in `any` mode and in multi-store plans.
- **Tom Thumb:** its regular prices are the highest in the set. It is competitive only through member prices, which is why they count by default.

Other seeded behaviour:
- **Seasonality:** produce varies ±15–30% sinusoidally by type (berries cheap Jun–Aug, citrus cheap Dec–Feb). Turkey is cheap in November. Baking goods go on sale in December. Grilling meats go on sale May–Jul.
- **Shocks:** eggs get one +40% supply shock lasting about six weeks.
- **Drift:** about +2.5% per year.

**Acceptance check:** the "Typical DFW family week" fixture list (35 items) shows a 10–25% saving between the best multi-store plan and the Kroger and Target baselines.

---

### 2.7 Store pre-selection (onboarding)
- **Rule:** a chain is pre-selected when its nearest location is **within 7.0 miles straight-line (haversine, no circuity factor)** of the user's home point. Users can tick or untick any chain afterwards.
- **Home point:** the centroid of the user's ZIP **[A-8]**.
- **Reference point:** the **Main St & Preston Rd intersection in Frisco, TX** (≈ 33.1500, −96.8065; confirmed in Phase 1 from geocodes of nearby Preston Rd addresses, e.g. 8555 Preston Rd ≈ 33.1473, −96.8075). It is used for three things:
  - the default origin before the user enters a ZIP;
  - the seeded demo user's home;
  - the e2e fixture user's home.
- **Fallback:** if no chain is within 7 miles, the 3 nearest chains are pre-selected and the UI says "No stores within 7 mi, showing the nearest".
- **Config:** `PRESELECT_RADIUS_MILES=7` and `DEFAULT_ORIGIN=33.1500,-96.8065` in config. Constants live in `core/geo`.
- **Seed constraint:** mock locations put most chains within 7 miles of the reference point, but **at least one chain's nearest location lies beyond 7 miles**, so the rule is visible and testable.

## 3. Architecture

```
apps/web          React 19 + Vite 8 + TS + Tailwind 4 + React Router + TanStack Query + Recharts
apps/api          Express 5 + TS, layered: routes → services → repositories (Drizzle) ; jobs/
packages/core     pure TS domain: units, size parser, money, cover cost, geo, dates, seeded RNG
packages/shared   Zod schemas = API contract (request/response types for web & api)
packages/db       Drizzle schema, SQL migrations, migrate/reset, test-database helpers
packages/pricing  PriceProvider contract, MockPriceProvider, catalog data, ingestion pipeline, seed
e2e/              Playwright
```
- **ORM: Drizzle (decided, Q-1).** The schema leans on Postgres features: generated columns, `daterange` with an exclusion constraint, a trigger, `pg_trgm`, `citext`, and window queries for historic lows. Drizzle is SQL-first and handles these as first-class SQL or custom migrations, without a Rust engine or codegen step. Its query builder also stays close enough to SQL for the comparison and history queries. Prisma would need `Unsupported(...)` fields and raw SQL for most of the interesting parts. You confirmed Drizzle.
- **Auth:**
  - **Access token:** a JWT (HS256, 15 min) in httpOnly cookie `sgs_at`.
  - **Refresh token:** an opaque 256-bit value in httpOnly cookie `sgs_rt` (path `/api/v1/auth`, 30 days). It is stored as a sha256 hash and rotated on every use. Reusing a rotated token revokes the whole family.
  - **CSRF:** SameSite=Lax plus a required `X-Requested-With: sgs` header on non-GET requests.
  - **Google:** OIDC Authorization Code + PKCE. When `GOOGLE_CLIENT_ID` is unset or `AUTH_GOOGLE_MODE=mock`, the API serves `/api/v1/auth/google/mock`, a dev-only consent page for entering a fake Google identity. Playwright can drive this page. **[Q-5]**
- **Jobs:** an in-process scheduler (`node-cron`) runs `price-sync` daily at 05:00 America/Chicago. `pnpm sim:advance --days N` replays the mock provider forward so historic-low alerts can be demoed and tested.
- **Distance:** haversine × 1.25 circuity factor. Route cost uses exact brute-force TSP over ≤3 stops plus home, at most 3! = 6 orderings per subset **[A-9]**.

---

## 4. Data model

The full DDL is in **Appendix A** (also `docs/schema.sql`). It was validated against PostgreSQL 16, including the
generated base quantity, the dimension trigger and the price-period exclusion constraint. Docker will run
`postgres:17`.

| Table | Purpose | Key constraints |
|---|---|---|
| `stores`, `store_locations` | 10 chains (+ loyalty program name); ~3–5 mock DFW locations each with lat/lng | `slug` unique |
| `users`, `auth_identities`, `sessions` | accounts, Google identities, refresh-token families | `email citext` unique; `(provider, subject)` unique |
| `user_stores` | per-user enabled stores, paid memberships, loyalty cards (default on), preferred location | PK `(user, store)` |
| `categories` | 2-level category tree | `slug` unique |
| `products` | canonical comparable items | `display_unit` and `default_unit` match `dimension` (or bridged) |
| `product_aliases` | synonyms for import/matching | unique `lower(alias)`, trigram index |
| `store_items` | packages at a chain; **unit normalization** | generated `base_quantity`; dimension trigger; `(store, sku)` unique |
| `price_points` | price periods incl. sale/promo | no overlaps (gist exclusion); `sale < regular` |
| `provider_sync_runs` | ingestion audit | — |
| `grocery_lists`, `list_items` | lists and templates (`user_id NULL` = system template) | brand/exact-item mode consistency checks |
| `price_alerts`, `notifications` | alert rules and in-app delivery | one alert per (user, product, kind); notification dedupe key |
| `trips`, `trip_items` | savings ledger: committed plans, snapshotted | generated `savings_cents`; snapshot `plan jsonb` |

**Key derived queries** (implemented as repository functions with SQL tests):
- *Current offers for a product:* active `store_items` ⨝ open `price_points`, filtered by eligibility.
- *Historic low:* `min(effective_price_cents / base_quantity)` over periods overlapping `[today-365, today]`, by product across eligible stores and by store item.
- *Savings by period:* `sum(savings_cents)` from `trips` by `date_trunc(interval, shopped_on)`.

**Savings definition [Q-2, decided]:** `baseline_total` is what the same list costs at the user's **baseline store**, using the same coverage rules at the same `price_as_of`. `savings = baseline − (items + fuel)`. Only committed trips count. Savings can be negative and are shown honestly.

---

## 5. REST API (`/api/v1`)

Conventions:
- JSON only, camelCase.
- Every request and response is defined by a Zod schema in `packages/shared`.
- Errors use the form `{ "error": { "code": "VALIDATION_FAILED", "message": "...", "details": [...] } }`.
- Lists use cursor pagination: `?cursor=&limit=` (default 25, max 100).
- 🔒 = requires auth. Unauthenticated requests get 401, and another user's resources return 404, never 403.

### Health
| Method | Path | Notes |
|---|---|---|
| GET | `/health` | liveness `{status:"ok", version, uptimeS}` |
| GET | `/health/ready` | DB ping + migration version + provider health; 503 if not ready |

### Auth
| Method | Path | Notes |
|---|---|---|
| POST | `/auth/register` | `{email, password(≥10), displayName}` → 201 + cookies; 409 if email exists |
| POST | `/auth/login` | → 200 + cookies; 401 generic message; rate-limit 10/15 min/IP+email |
| POST | `/auth/refresh` | rotates refresh token; reuse ⇒ 401 + family revoked |
| POST | `/auth/logout` | 🔒 revokes current family; clears cookies |
| GET | `/auth/google` | 302 to Google (or mock consent) with state + PKCE |
| GET | `/auth/google/callback` | links by verified email or creates user; 302 to app |
| GET | `/auth/me` | 🔒 current user + onboarding state |

### Profile & stores
| Method | Path | Notes |
|---|---|---|
| PATCH | `/me` | 🔒 displayName, homeZip (geocoded from bundled DFW ZIP centroids **[A-8]**), vehicleMpg, fuelCentsPerGal, baselineStoreId, theme |
| GET / PUT | `/me/stores` | 🔒 enabled, hasMembership, hasLoyalty, preferredLocationId per store |
| GET | `/stores` | chains |
| GET | `/stores/:slug/locations?near=lat,lng` | sorted by distance |

### Catalog
| Method | Path | Notes |
|---|---|---|
| GET | `/categories` | tree |
| GET | `/products?q=&categoryId=&cursor=` | trigram + full-text search incl. aliases |
| GET | `/products/:id` | product + store items + current offers (unit price, sale flags, historic-low badge) |

### Lists & templates
| Method | Path | Notes |
|---|---|---|
| GET / POST | `/lists` | 🔒 `?archived=false`; create `{name, fromTemplateId?}` |
| GET / PATCH / DELETE | `/lists/:id` | 🔒 GET includes items grouped by category; PATCH name/description/archived |
| POST | `/lists/:id/duplicate` | 🔒 |
| POST | `/lists/:id/items` | 🔒 `{productId? , rawText, quantity, unit?, matchMode, brand?, storeItemId?}`; free text auto-matched if ≥ threshold |
| PATCH / DELETE | `/lists/:id/items/:itemId` | 🔒 |
| PUT | `/lists/:id/items/order` | 🔒 `{itemIds: [...]}` full order |
| GET | `/templates` | 🔒 system + mine |
| POST | `/lists/:id/save-as-template` | 🔒 |
| POST | `/imports/preview` | 🔒 `multipart file (csv ≤ 1 MB, ≤ 500 rows)` or `{text}` → parsed lines `{raw, quantity, unit, candidates[{productId, name, score}], status: matched|ambiguous|unmatched}` |
| POST | `/imports/commit` | 🔒 `{listId \| newListName, lines:[{raw, productId?, quantity, unit?}]}`. Stateless: the client sends the reviewed lines back |

CSV format: header row required. Columns `item` (required), `quantity`, `unit`, `brand`, `notes`, matched case-insensitively.
Text format: one item per line, with leading quantity and unit parsed ("2 lb ground beef", "milk x2", "3 avocados").

### Comparison
| Method | Path | Notes |
|---|---|---|
| GET | `/lists/:id/comparison?asOf=&stores=` | 🔒 per item × store `{storeItem, packages, lineCents, unitPrice{cents, per}, onSale, approximate, overbuy, missing}`; per store `{totalCents, missingCount, complete}`; `cheapestStoreId`, per-item `cheapestStoreId`, `baseline`, `savingsPct` |
| GET | `/products/:id/offers` | current offers across user's eligible stores |

### History & alerts
| Method | Path | Notes |
|---|---|---|
| GET | `/products/:id/history?range=30d\|90d\|365d&stores=` | step series per store (unit price in display unit), plus `historicLow {unitPrice, storeId, date}` |
| GET | `/store-items/:id/history?range=` | package price series (regular vs sale) |
| GET / POST | `/alerts` | 🔒 `{productId, kind, targetCents?}` |
| PATCH / DELETE | `/alerts/:id` | 🔒 |
| GET | `/notifications?unread=true` | 🔒 |
| POST | `/notifications/:id/read`, `/notifications/read-all` | 🔒 |

### Trips, dashboard & export
| Method | Path | Notes |
|---|---|---|
| POST | `/trips` | 🔒 commit a plan `{listId, plan: {storeIds: 1–3}, shoppedOn}` (strict; Phase 7 may add `planId`). The server recomputes the plan at `price_as_of` = `shoppedOn` and snapshots it, so client totals are never trusted. `shoppedOn` must be within the last 365 days (America/Chicago) |
| GET | `/trips`, `/trips/:id` | 🔒 |
| DELETE | `/trips/:id` | 🔒 |
| GET | `/dashboard/summary?from=&to=` | 🔒 KPIs: totalSavedCents, avgSavingsPct, tripCount, bestStore, fuelSpentCents (+ totalSpentCents, baselineTotalCents). Range defaults: `to` = today, `from` = `to` − 365 days; ≤ 10 years |
| GET | `/dashboard/series?metric=savings\|spend&interval=week\|month&from=&to=` | 🔒 |
| GET | `/dashboard/breakdown?by=store\|category&from=&to=` | 🔒 |
| GET | `/exports/savings.csv?from=&to=` | 🔒 one row per trip item, plus one `fuel` row per trip with fuel, so the Saved column sums to totalSavedCents |
| GET | `/exports/savings.pdf?from=&to=` | 🔒 summary + KPI table + per-trip table (server-rendered, `pdfkit`) |

### Optimizer
| Method | Path | Notes |
|---|---|---|
| POST | `/lists/:id/optimize` | 🔒 read-only (POST for the options body). body `{maxStores: 1..3 = 3, origin?: {lat,lng}, mpg?, fuelCentsPerGal?, timeValueCentsPerHour? = 0, minutesPerStop? = 10}`; `settings.matchesTrip` is false when origin/mpg/fuel are overridden → `{single: Plan, multi: Plan[], recommendation}`. Each Plan: stores, ordered route, per-item assignment, itemsCents, distanceMiles, fuelCents, timeCents, totalCents, savingsVsBaselineCents, missing[] |

**Optimizer algorithm (exact):** E = eligible chains, |E| ≤ 10, using each chain's nearest or preferred location.
1. For every subset S ⊆ E with |S| ≤ maxStores (≤ 175 subsets for maxStores = 3: 10 + 45 + 120), assign each item to its cheapest line in S. With S fixed, items are independent, so this step is exact.
2. Compute the cheapest round-trip route home → S → home by brute force.
3. Plan total = items + fuel + time.
4. Rank plans, preferring complete ones. The recommendation is multi-store only if it beats the best single store by ≥ max($3, 3%) **[Q-4]**.

---

## 6. Screens (mobile-first, 360px design width; ≥1024px gets a two-pane layout)

Global shell:
- **Top bar:** title, dark-mode toggle, notifications bell with unread count.
- **Bottom tab bar on mobile, left rail on desktop:** Lists · Compare · Deals/History · Dashboard · Settings.
- **Demo banner:** while `PRICE_PROVIDER=mock`, a slim, dismissible-per-session banner reads "Demo prices: not real store prices" **[Q-9]**.
- **Visuals:** Tailwind `dark:` variants with class strategy. Theme is stored on the user and mirrored to localStorage. Store colours appear only as small chips with text labels.

```
S1 Login / Register            S2 Onboarding (3 steps)        S3 Lists (home)
┌──────────────────────┐       ┌──────────────────────┐       ┌──────────────────────┐
│  🛒 Smart Grocery    │       │ Step 1/3  Where?     │       │ My Lists        [+]  │
│      Saver           │       │ ZIP [75024     ]     │       │ ┌──────────────────┐ │
│ [G  Continue w/Google]│      │ Step 2/3  Stores     │       │ │Weekly staples    │ │
│ ── or ──             │       │ ☑ Walmart ☑ Kroger   │       │ │24 items · $142.10│ │
│ Email [           ]  │       │ ☑ Costco  ☐ member   │       │ │best: Aldi  -18%  │ │
│ Pass  [           ]  │       │ ☑ H-E-B   ☑ Aldi ... │       │ └──────────────────┘ │
│ [   Log in        ]  │       │ Usual store: [Kroger]│       │ ┌──────────────────┐ │
│ New? Create account  │       │ Step 3/3  Car mpg[25]│       │ │Taco night        │ │
└──────────────────────┘       │        [Continue]    │       │ └──────────────────┘ │
                               └──────────────────────┘       │ Templates · Import   │
                                                              └──────────────────────┘
S4 List detail / editor        S5 Import                      S6 Compare
┌──────────────────────┐       ┌──────────────────────┐       ┌──────────────────────┐
│← Weekly staples  ⋯   │       │ Import items         │       │← Weekly staples      │
│[🔍 Add item…      ]  │       │ (•)Paste text ( )CSV │       │ Kroger (usual) $142  │
│ DAIRY                │       │ ┌──────────────────┐ │       │ ★ Aldi  $116  -18% ✓ │
│ ☐ Whole milk  2 gal  │       │ │2 lb ground beef  │ │       │   Walmart $121 -15%  │
│   any brand  ⇢$6.58  │       │ │milk x2           │ │       │   Costco $109 ⚠3 miss│
│ ☐ Large eggs  12 ea  │       │ └──────────────────┘ │       │ ──── per item ────   │
│ PRODUCE              │       │ [Preview]            │       │ Whole milk · 2 gal   │
│ ☐ Bananas     3 lb   │       │ ✓ Ground beef 80/20  │       │ ★Aldi $5.98 4.7¢/floz│
│ ☐ Avocados    4 ea ≈ │       │ ? milk → Whole|2%  ▾ │       │  Kroger $6.58 ⓢsale  │
│ [Compare prices →]   │       │ ✗ "zesty thing" skip │       │  Costco $6.49 (2-pk) │
└──────────────────────┘       │ [Add 11 items]       │       │ [Optimize trip →]    │
                               └──────────────────────┘       └──────────────────────┘
S7 Product detail / history    S8 Optimizer / plan            S9 Dashboard
┌──────────────────────┐       ┌──────────────────────┐       ┌──────────────────────┐
│← Whole Milk          │       │ Best plan            │       │ Savings  [Month ▾]   │
│ Lowest now: Aldi     │       │ ◉ 2 stores  $109.40  │       │ ┌────────┬─────────┐ │
│ 4.7¢/fl oz 🏷 1yr low │      │  Aldi→Costco 11.2 mi │       │ │$212    │ 17.4%   │ │
│ [30d][90d][365d]     │       │  fuel $1.27 save $33 │       │ │saved   │avg saved│ │
│  ╭─╮_  ___/‾‾        │       │ ○ 1 store  Aldi      │       │ ├────────┼─────────┤ │
│ ─╯  ‾‾‾  (per store) │       │   $116.10 save $26   │       │ │9 trips │best:Aldi│ │
│ Store   now   unit   │       │ ✓ Extra stop worth   │       │ └────────┴─────────┘ │
│ Aldi   2.98  4.7¢    │       │   it: +$6.70 net     │       │ ▁▃▅▆▇ savings/month  │
│ Kroger 3.29s 5.1¢    │       │ Route ▸ map list     │       │ by store ▓▓▓▒▒░      │
│ [🔔 Alert me at low] │       │ [I shopped this ✓]   │       │ [CSV] [PDF]          │
└──────────────────────┘       └──────────────────────┘       └──────────────────────┘
S10 Notifications: list of alert hits ("Whole milk hit a 1-year low at Aldi: $2.98"), mark read, link to S7.
S11 Settings: profile, ZIP, stores, memberships & loyalty cards (Tom Thumb for U and Kroger Plus Card on by default), vehicle/fuel, time value, baseline store, theme, log out.
S12 Templates: system + mine; preview; "Use template".   S13 Trip history/detail: snapshot of a committed plan.
S2 lists all 10 stores. A chain is pre-selected if any of its locations is within 7 miles of the user's home (rule in
§2.7). Costco and Sam's ask about membership, and Tom Thumb and Kroger show their loyalty card as on.
Empty/error/loading states are required for every screen (skeletons, retry, offline banner).
```

---

## 7. Phase plan & acceptance criteria

**Definition of Done (every phase):**
- `pnpm verify` is green. It runs `typecheck`, `lint`, `test` (unit + API) and `test:e2e`.
- No new `any`. No skipped tests without a linked open question.
- Every feature in the phase has tests at the right layer.
- SPEC and CLAUDE.md are updated if reality diverged.
- I stop and wait for your review before the next phase.

### Phase 0: Spec (this document)
- [x] SPEC.md, CLAUDE.md, OPEN_QUESTIONS.md. DDL validated on PostgreSQL 16.

### Phase 1: Scaffold
- pnpm workspace with `apps/web`, `apps/api`, `packages/{core,shared,db}`, `e2e`. TS project references, strict mode, ESM.
- Tooling: ESLint flat config (typescript-eslint strict-type-checked, react-hooks, jsx-a11y), Prettier and EditorConfig.
- `docker-compose.yml`: Postgres 17 on host port 5433 with a healthcheck, and the `sgs_dev` and `sgs_test` DBs created by an init script.
- Drizzle schema equivalent to Appendix A. Migrations in `packages/db/migrations`, including custom SQL for the functions, trigger and exclusion constraint.
- `packages/core/units`: factor table, conversions, `parseSize`, `unitPrice`, `coverCost`.
- `MockPriceProvider` and the ingestion pipeline (normalize → match → upsert → periods).
- Seed: 10 stores, ~40 DFW mock locations, ~14 categories, **≥150 products**, items at all 10 stores, **12 months** of periods, Tom Thumb and Kroger member-only prices.
- API `/health` and `/health/ready`. The web app shell renders and shows API health. Dark-mode toggle works.
- `scripts/verify.mjs` (Node, so it also runs on Windows; was `verify.sh`) and a GitHub Actions workflow that runs it with a Postgres service.

**Delivered (2026-11-16): `pnpm verify` green — 197 unit/API/DB tests + 8 e2e (mobile + desktop).** Deviations from the plan above:
- **New package `packages/pricing`.** It holds the provider contract, mock provider, catalog data, ingestion and seed. The seed must use the ingestion pipeline, and `db` must not depend on `api`, so this code couldn't live in `apps/api/providers` or `packages/db/seed` as originally planned. Dependency direction: `api → pricing → db → core`.
- **Typecheck runs `tsc` per package** (`pnpm -r typecheck`). TS project references are not used: workspace packages export their TypeScript source directly, and tsx, Vite and Vitest consume it.
- **Version pins:**
  - React 19 and Tailwind 4 (current majors) rather than React 18.
  - TypeScript 5.9, because typescript-eslint doesn't support TS 7 yet.
  - ESLint 9, because jsx-a11y doesn't support ESLint 10 yet.
  - `@playwright/test` 1.63.0, to match the preinstalled browsers.
- **Test databases are created per suite** (`sgs_test_<suite>`) by the harness, so packages can test in parallel. docker-compose's init script creates only `sgs_e2e`.
- **Local Postgres fallback:** `pnpm db:up` uses docker compose, or a local PostgreSQL install when no Docker daemon is available. That is how this environment ran, on PG 16. CI uses `postgres:17-alpine`.
- **Catalog size:** 189 products, 14 aisles under 4 departments, 205 aliases, 1,919 store items, about 25k price periods. The seed takes about 17 s.
- **Planted review-queue items:** each chain has 2 deliberately unmatchable "seasonal" items and 1 unparseable size ("varies"). They exercise the review queue, and a test checks the matcher against provider ground truth: zero wrong matches, and every match method is used.
- **Calibration** at seed `20261116`, anchor `2026-11-01`. All chain indices fall inside §2.6. Family week: best plan of up to 3 stores $159.53 vs Kroger $187.84 (−15.1%) and Target $208.36 (−23.4%). The Target figure sits near the 25% ceiling.

**Acceptance:**
1. From a fresh clone, `pnpm i && pnpm db:up && pnpm db:reset && pnpm dev` produces a web app on :5173 showing "API: ok" and an API on :4000 where `/health/ready` returns 200.
2. Seed is deterministic: two runs with the same `SEED`/`SEED_ANCHOR_DATE` produce identical row hashes. It finishes in under 60 s.
3. Seed coverage tests confirm the following.
   - ≥150 products. Every chain has items.
   - Every product has items at ≥4 chains.
   - Every item has continuous coverage over 365 days, with no gaps or overlaps.
   - Each chain except Trader Joe's has ≥1 sale per month. Trader Joe's has none.
   - Tom Thumb and Kroger have member-only periods every month.
   - At least one chain's nearest location is beyond 7 miles of the Frisco reference point, and most chains are within it (§2.7).
   - Sprouts' Wednesday overlap produces no overlapping periods.
   - Chain price indices fall inside the §2.6 calibration table.
   - The family fixture list's saving falls in the 10–25% band.
4. Unit tests pass for the following.
   - The factor table, checked against the DB `unit_factor()` (parity).
   - `parseSize` against ≥60 fixtures.
   - Round-trip conversions.
   - `coverCost`, including multi-pack and multi-buy cases.
5. DB tests confirm the dimension trigger and the exclusion constraint reject bad data.
6. `pnpm verify` passes locally and in CI.

### Phase 2: Auth
- Register, login, logout, refresh rotation with reuse detection, and `/auth/me`.
- Google OIDC with PKCE, plus the mock consent mode.
- Account linking: a verified Google email that equals an existing email links to that account.
- `requireAuth` middleware, rate limiting, CSRF header check.
- Web: S1, S2 onboarding, S11 basics, route guards, silent refresh on 401.
- Seeded **demo user** `demo@sgs.test` (dev only; password from `DEMO_USER_PASSWORD`):
  - Home at the Frisco reference point (§2.7).
  - **Costco membership on**, Sam's off.
  - Tom Thumb and Kroger cards on.
  - Kroger as usual store.
  - The e2e fixture user uses the same profile.

**Acceptance:**
1. Supertest covers the following.
   - Happy paths for every endpoint.
   - Duplicate email returns 409.
   - Wrong password returns 401 with no user enumeration (same message and similar timing).
   - Rate limit returns 429.
   - Expired access + valid refresh rotates the token.
   - Replayed refresh revokes the family.
   - Logout invalidates the session.
   - Protected routes return 401 unauthenticated.
   - A cross-user resource returns 404.
2. The Google mock flow creates a user, and the second login links rather than duplicates.
3. Onboarding pre-selection (unit + API): a chain exactly 7.0 mi away is included, and one at 7.01 mi is excluded. The no-stores-in-range fallback returns the 3 nearest. A user at the Frisco reference point gets the expected seeded set.
4. No password hashes or tokens ever appear in responses or logs (log redaction test).
5. Playwright: register → onboarding (from the Frisco reference home, the expected chains are pre-checked and Tom Thumb/Kroger cards show as on) → land on Lists. Logout → protected URL redirects to login. Login with Google (mock).

**Delivered (2026-11-16): `pnpm verify` green.** Endpoints: register, login, refresh, logout, `/auth/me`, Google start and callback, the mock consent page and form post, `PATCH /me`, `GET/PUT /me/stores`, `GET /stores` and `GET /stores/:slug/locations`. Notes and deviations:
- **`GET /me/stores`** computes the §2.7 pre-selection on the server. Each store also carries `nearestLocation`, `preselected` and `saved`. Until the user saves, the defaults are: pre-selected stores enabled, loyalty cards on, memberships off.
- **Sessions:**
  - Every authenticated request also checks that the session family is not revoked, so logout takes effect at once instead of when the 15-minute access token expires.
  - A rotated refresh token presented again within 10 s is treated as a multi-tab race: it gets a 401 but the family is not revoked. After 10 s, a replay revokes the whole family.
- **Google:**
  - The real client is OIDC + PKCE (S256) with nonce, issuer and audience checks. It is tested against a local fake issuer with RS256 keys; it has not been run against real Google.
  - Unverified Google emails never link to or create an account.
  - The mock consent form post is exempt from the CSRF header check, because it is a plain HTML form. It is protected by the signed, httpOnly OAuth-state cookie instead.
- **ZIP → home:** 255 DFW ZIP Code Tabulation Area centroids (US Census, via the MIT-licensed `us-zips` package), bundled in `@sgs/core`. A ZIP outside DFW returns 422.
- **New env var `AUTH_RATE_LIMIT_SCALE`** (default 1). It multiplies the auth rate limits so e2e can sign in many times from one IP. Startup fails if it isn't 1 in production. Production also refuses the mock Google login, the dev JWT secret and insecure cookies.
- **Web forms** are plain controlled forms validated with the shared Zod schemas, not react-hook-form; adopt it later only if forms get complex. The theme is saved to the account when signed in, and the account's theme is applied at sign-in.
- **Cross-user 404 is not testable yet.** No user-owned resource is addressable by id in Phase 2. Per-user isolation of store settings is tested. Real cross-user 404 tests arrive with lists in Phase 3.
- **Open-question defaults applied:** Q-5 (JWT + rotating refresh) and Q-6 (no password reset or email verification in MVP).

### Phase 3: Grocery lists
- List CRUD, items CRUD, reorder, check-off and category grouping.
- Product search with typeahead.
- Free-text auto-match.
- Templates: ≥5 system templates (Weekly staples, Taco night, Breakfast, Kid lunches, Holiday baking), save-as-template and instantiate.
- CSV and text import: preview, then commit.

**Acceptance:**
1. Unit tests: the text line parser (≥40 fixtures, e.g. "2 lb beef", "milk x2", "1/2 gal oj", "dozen eggs") and the CSV parser (header variants, quoted commas, BOM, bad rows reported with line numbers).
2. API tests confirm the following.
   - Ownership isolation.
   - Reorder is persisted.
   - Template instantiate produces a deep copy, so editing the copy leaves the template unchanged.
   - Import limits return 413/422.
   - Ambiguous lines are never auto-committed.
3. Importing the 35-line family fixture matches ≥90% automatically, with no wrong matches.
4. Playwright: create list → add 5 items via search → import pasted text → reorder → check off → reload persists. Works at 360px and in dark mode.

**Delivered (2026-11-16): `pnpm verify` green.** Notes and deviations:
- **Endpoints, as in §5:**
  - Lists: CRUD, items, reorder, duplicate, save as template.
  - `GET /templates`, plus a new `GET /templates/:id` for previews.
  - `GET /products` (typeahead search), `GET /products/:id`, `GET /categories`.
  - Import preview and commit.
- **Import is JSON, not multipart.** The body is `{format: 'text'|'csv', content}`, with the CSV read in the browser. Limits are unchanged: a body over 1 MB → 413, over 500 lines → 422, an unclosed CSV quote → 422 with its line number.
- **Matching** (shared by free-text items and import):
  - An exact name or alias match wins.
  - Otherwise the best pg_trgm match must score ≥ 0.6 and beat the runner-up by ≥ 0.15.
  - Anything below that is `ambiguous` (candidates scoring ≥ 0.3) or `unmatched`. Commit never auto-matches, so ambiguous lines stay free text unless the user picks a product.
  - Family-week text import: **35/35 matched, 0 wrong**.
- **Units are fitted to the product:** a bare "oz" on a liquid becomes fl oz. Units that don't fit are dropped on import, and rejected with 422 when set directly.
- **Reordering:** the API takes the full order. The UI moves items within their aisle group, because moving across groups would show no visible change.
- **Ids:** a non-UUID path id returns 404. Another user's list or item also returns 404, never 403, for every list, item, template and import route (tested).
- **Seed:** 5 system templates. The demo user also gets a "Family week" list (the 35-item fixture), ready for Phase 4.
- **Phase 2 bug fixed:** dark-mode primary buttons failed WCAG contrast (white on `brand-600`, 3.3:1). They now use `brand-700` (about 5:1). The e2e accessibility check found it once it covered a dark-mode form.

### Phase 4: Price comparison
- The comparison service in `core`: eligibility, coverCost, totals, cheapest, savingsPct, approximate/missing flags.
- `/lists/:id/comparison` and `/products/:id/offers`.
- Screens S6 and S7 (offer table only).

**Acceptance:**
1. Core unit tests cover the following.
   - Unit price per display unit for all three dimensions.
   - The bulk pack that costs more for a small need.
   - Multi-buy `min_qty`.
   - Per-weight items.
   - The count↔mass bridge flagged approximate.
   - Brand and exact-item modes.
   - Warehouse clubs: Costco counts for a member. For a non-member it is absent from the response, not flagged or greyed out.
   - Loyalty pricing for both Tom Thumb and Kroger: the member price applies when `hasLoyalty` (the default) and the regular price applies when it's off. Turning it off can change the cheapest store.
   - Missing items mark the store incomplete.
   - Ties.
   - Half-even rounding.
2. Property tests (fast-check):
   - The cheapest store total ≤ every complete store total.
   - Doubling the quantity never decreases cost.
   - Savings % is in [−∞, 100).
3. API: golden-file comparison for the family fixture at a pinned `asOf`. p95 < 300 ms over 50 runs.
4. Playwright: list → Compare shows the cheapest store with a star icon and text (not colour only). Percentages match the API. Toggling a store off recomputes. For the demo profile, Costco appears as a normal column and Sam's Club does not appear.

**Delivered (2026-11-17): `pnpm verify` green.** Notes and deviations:
- **Engine:** `compareList` in `@sgs/core` is pure. The API loads each offer's price period at `asOf` in one query (`valid_during @> asOf`), and `asOf` defaults to today in America/Chicago. Family-week latency is p50 11 ms and p95 15 ms against the 300 ms target.
- **Eligibility:**
  - Disabled stores and clubs without a membership are omitted from comparisons (Q-3) and listed under `excluded` with a reason.
  - `?stores=` narrows the comparison further. Every eligible store stays listed under `available`, so the UI can toggle it back on.
- **Member and loyalty prices:**
  - A user who doesn't qualify for a member-only price pays the regular price.
  - A multi-buy deal counts only when the packages bought reach its minimum; below that, the sale and card flags show what was actually paid.
- **Cheapest and baseline:**
  - "Cheapest" is the cheapest store that carries every priced item. Ties go to display order.
  - `cheapestWithMissingStoreId` is the store with the fewest missing items, then the lowest total.
  - The baseline is the user's usual store when it is complete; otherwise the median-priced complete store (Q-2).
  - Savings % are rounded to one decimal and are null when not comparable.
- **Golden file:** `apps/api/test/__golden__/family-week-comparison.json`, demo profile, seed 20261116, asOf 2026-11-01. Golden files are excluded from Prettier.
  - Walmart is the cheapest single store: $173.23, saving $14.61 (7.8%) vs Kroger at $187.84.
  - Aldi and Sprouts are cheaper on what they carry but are missing 10 and 12 items, so they are never "cheapest".
  - The 10–25% band in §2.6 is for a plan of up to 3 stores (Phase 7).
- **`GET /products/:id/offers`** returns current offers only (sign-in required). The historic-low badge moves to Phase 5 along with history.
- **New screens:**
  - `/compare` (list picker).
  - `/lists/:id/compare` (S6).
  - `/products/:id` (S7, current offers only).
  - A "Compare prices" button on the list page.

### Phase 5: Price history & alerts
- History endpoints (step series), and charts with 30/90/365 toggles, per-store lines and the historic-low marker.
- Alert CRUD, alert evaluation in ingestion, notifications, and the bell badge.
- `pnpm sim:advance`.

**Acceptance:**
1. SQL tests check that history for a range returns the correct period boundaries, clipped to the range, with no gaps.
2. The historic low equals a brute-force daily scan over seed data for 20 random products.
3. Alert tests check the following.
   - Advancing the simulation to a planted historic-low day creates exactly one notification per subscribed user (dedupe).
   - A price equal to the prior low triggers only if strictly lower **[Q-7]**.
   - Inactive alerts are silent.
   - Target-price alerts compare in the display unit.
4. Playwright: product page → toggle 30/90/365 (the chart renders the expected series count) → create alert → `sim:advance` via test hook → bell shows 1 → notification opens the product.

**Delivered (2026-11-17): `pnpm verify` green.** Notes and deviations:
- **History** is a per-store step series of the day's lowest unit price, computed on the server from price periods and clipped to the range.
  - The range ends on today's date in America/Chicago and starts N−1 days earlier.
  - Only the user's eligible stores are included, with their member and loyalty prices. A multi-buy price counts at the single-package price.
  - Tests compare every day of the 90-day series for 6 products, and the 365-day historic low for 21 products, against independent SQL brute-force scans.
- **Historic low:** the lowest unit price at any eligible store in the 365 days ending today. "At its 1-year low" means today's best price equals it.
- **Alerts:**
  - A historic-low alert fires only when today's best price is *strictly* below the prior 365-day low (Q-7; a tie doesn't fire).
  - A target-price alert fires at or below the target, in cents per the product's display unit.
  - Notifications are de-duplicated per (alert, price point). Re-running a day, or a price that stays low for several days, notifies once.
- **Market simulation:**
  - Migration `0001` adds `provider_sync_runs.kind` (`full`/`daily`) and `as_of`; the market date is the latest `as_of`.
  - `pnpm sim:advance [--days N | --to DATE]` ingests each day, then evaluates alerts.
  - `PLANTED_LOWS` (`packages/pricing/src/catalog/planted.ts`) is a deterministic clearance on Walmart honey from anchor+1 for 3 days, so alerts can be demoed and tested.
- **Test hook:** `POST /api/v1/test/sim/advance` is mounted only with `ENABLE_TEST_HOOKS=true`, and startup fails if that's set in production. The e2e spec that moves the market runs in its own Playwright project (`sim`) after the mobile and desktop projects finish, so it never races the price-reading specs.
- **Chart** (Recharts, dataviz reference palette slots 1–4, validated light and dark):
  - At most 4 store lines at once, chosen with checkboxes. The default is the cheapest stores plus your usual store. A store keeps its colour while others are toggled.
  - Dashed 1-year-low line, crosshair tooltip, and end labels nudged so they don't overlap.
  - A data table view. It's required because two light-mode slots are below 3:1 contrast.
- **Search fix:** an exact name or alias match now ranks first. "honey" used to return Honeycrisp Apples ahead of Pure Clover Honey; the e2e spec caught this.
- **New screens:** Deals & History tab (`/deals`), Notifications with an alerts list (`/notifications`), and a header bell with an unread count. The product page now shows history and alert controls.
- **Refactor:** the effective store-settings view moved to `@sgs/pricing` (`userStoreView`), so the API and alert evaluation share one implementation.

### Phase 6: Savings dashboard
- Trips: commit a plan with a server-side recompute and snapshot.
- Summary, series and breakdown endpoints. KPI cards and charts (Recharts) in S9.
- CSV and PDF export. Trip history S13.

**Acceptance:**
1. Aggregation tests on a seeded trip ledger: totals equal the sum of trips; month buckets are in America/Chicago; negative savings are included; an empty range returns zeros, not errors.
2. The trip snapshot is immutable when later prices change.
3. CSV is RFC 4180, opens in Excel/Sheets and contains formula-injection-safe cells (leading `= + - @` escaped).
4. PDF: valid, one page per ≤40 trips, totals match the API (parsed in test with `pdf-parse`).
5. Playwright: commit 2 trips → dashboard KPIs match → download CSV and PDF (files exist and are non-empty) → charts readable in dark mode.

**Delivered (2026-11-17): `pnpm verify` green.** Notes and deviations:
- **Committing a trip** (`POST /trips {listId, plan: {storeIds}, shoppedOn}`; strict schema, so client totals are rejected):
  - The server re-runs the comparison at `price_as_of = shoppedOn`. Backdated trips are priced from history on that day; `shoppedOn` must be today or up to 365 days earlier (America/Chicago).
  - With several stores, each item goes to its cheapest line among them (ties → the store listed first). Core `planFromComparison`.
  - **Like-for-like baseline:** items the baseline store can't price are left out on *both* sides, so `baseline_total` covers exactly the items bought. Skipped items are listed in the snapshot. No complete baseline store → 422.
  - **Route and fuel:** home → stores → home by brute force (core `bestRoute`, road miles = haversine × 1.25), using each store's preferred or nearest location. Fuel = miles ÷ mpg × the user's price (or `FUEL_CENTS_PER_GAL_DEFAULT`, 279), rounded half-even once. This is the routing Phase 7 reuses.
  - **Snapshot:** `trips.plan` holds list name, store names in route order, every bought line, skipped items, mpg and fuel price. Reads use only the snapshot and the trip columns, so later price, store-name or list changes never alter a trip (tested by doubling every price and renaming the list after committing).
- **Dashboard:**
  - `avgSavingsPct` = total saved ÷ baseline total (weighted by spend, not a mean of per-trip %).
  - `bestStore` = the store with the largest item-level saving (before fuel); none when nothing was saved.
  - Series buckets: weeks start Monday (ISO, = Postgres `date_trunc`), months on the 1st; `shopped_on` is already a Chicago date. Every bucket in the range is returned, empty ones as zero.
  - Breakdowns are item-level (fuel can't be split by store or category); "Other" is used for products without a category, and the UI folds rows beyond 7 into "Other".
- **CSV:** RFC 4180 with CRLF and a UTF-8 BOM (for Excel). Text cells starting with `= + - @`, tab or CR get a leading apostrophe; money is written as plain decimals (negative savings stay numeric). Adds a **fuel row per trip** (deviation from "one row per trip item") so the Saved column reconciles with the dashboard.
- **PDF** (`pdfkit`, Letter): title, range, "Demo prices" note, KPI table on page 1, then the trip table, 40 trips per page. Tests parse it with `pdf-parse` (page count, every KPI label and value equal to the API).
- **UI:**
  - "I shopped this" on the Compare screen: 1–3 stores (the cheapest is pre-selected) and the date.
  - Dashboard (S9): range (3 months / 12 months / all), KPI cards, saved or spent per month or week (bars coloured by sign, and labelled in words), and saved by store or category with direct value labels. Every chart has a data table. CSV and PDF downloads.
  - Trip history and detail (S13), with a confirmed delete.
- **Dev data:** `pnpm db:seed` now also commits 24 demo trips over the past year through the real trip service (`apps/api/src/cli/seed-demo-trips.ts`). Test and e2e databases don't get them.
- **Fixes:** the 404 page said "Coming in Phase 0"; it now says the page doesn't exist and links home.

### Phase 7: Single- vs multi-store optimizer
- The `core/optimizer` (exact subset enumeration + brute-force route), fuel and time cost, and the recommendation rule.
- `/lists/:id/optimize` and screen S8, with "I shopped this" creating a trip.

**Acceptance:**
1. Unit tests check the following.
   - The optimizer equals a brute-force oracle on 200 random small instances (property test).
   - The route is optimal for ≤3 stops.
   - Fuel = miles / mpg × price.
   - Zero items gives a $0 plan.
   - Missing coverage is ranked below complete plans.
   - `maxStores = 1` equals the Phase 4 cheapest store plus fuel.
2. Recommendation threshold boundary tests.
3. Performance: 100-item list, 10 stores, maxStores 3 runs in under 500 ms p95.
4. Playwright: optimize → choose the multi-store plan → "I shopped this" → dashboard total increases by the plan's savings.

**Delivered (2026-11-17): `pnpm verify` green.** Notes and deviations:
- **Optimizer** (`packages/core/src/optimizer/optimize.ts`), exactly the §5 algorithm:
  - Every subset of the routable eligible stores with up to `maxStores` stores (175 for 10 stores and 3 stops). Each item goes to its cheapest line in the subset; ties go to the lower store id.
  - A subset whose cheapest assignment leaves one of its stores unused is the same plan as the smaller subset, so it is skipped (with the triangle inequality, an extra stop never shortens the route).
  - Route: brute-force round trip (`bestRoute`, shared with trips). Total = groceries + fuel + time.
  - Ranking: fewer missing items, then lower total, then fewer stores. `single` is the best one-store plan; `multi` holds the best 3 plans with 2+ stores.
  - **Recommendation (Q-4):** a multi-store plan is recommended if it covers more items, or covers the same items and saves at least max($3, 3% of the single-store total) after fuel and time. Exactly the threshold counts.
  - **Time cost** is off by default; when on, it counts minutes per stop plus driving at 30 mph (new assumption **A-18**). It affects ranking only.
  - Measured: about 2 ms median for 100 items × 10 stores × 3 stops (p95 12 ms) against the 500 ms budget. The API test, 20 runs end to end including the database, also stays under 500 ms p95.
- **Plans and trips agree by construction:**
  - `savingsVsBaselineCents` = baseline − (groceries + fuel), which is exactly what logging the plan records.
  - Plans and trips share `tripSettings` (home, car, each store's preferred-or-nearest stop) and the same route and fuel code.
  - An API test logs both the single and the best multi plan and checks the trip's groceries, fuel, distance, baseline, savings and route equal the plan's.
- **Not in the plan:** stores without a mapped location (none in DFW mock data). Overrides for origin, mpg or fuel are accepted for "what if" runs and flagged with `settings.matchesTrip = false`; the S8 screen doesn't send them (car and fuel are edited in Settings).
- **S8 "Plan your trip"** (`/lists/:id/plan`, linked from Compare):
  - Stop limit (1 / up to 2 / up to 3), "Count my time" ($/hr and minutes per stop, remembered on the device).
  - The verdict in words, the plans as radio cards with the recommended one pre-selected, the route with a per-store shopping list, and "I shopped this" with a date.
- **Performance and cleanup:**
  - The product, dashboard, plan, trips and import screens now load on demand. The first download shrank from 950 kB to 517 kB (gzipped 275 → 154 kB); the chart library (355 kB) loads only with a chart.
  - Fixed: on Compare, a long store name ("Sprouts Farmers Market") wrapped its total onto a misaligned line.

---

## 8. Roadmap (post-MVP, not scheduled)
1. **Real price providers.** Retailer APIs, licensed data feeds, and receipt/flyer ingestion. Comes with a legal/ToS review **[Q-8]** and a matching review admin UI. Trader Joe's publishes no online prices, so it likely needs receipt or crowd-sourced data.
2. **Pantry.** Track what's on hand and auto-suggest lists.
3. **Deal engine.** Weekly-ad ingestion, stock-up signals ("buy 3, it's a 1-year low"), and coupon stacking.
4. **Budgets.** Monthly budget, category caps, pace alerts.
5. **Meal planning.** Recipes become lists, with plans optimized for the week's deals.
6. **AI features.** Natural-language list entry, photo-of-handwritten-list import, smarter substitutions ("store-brand equivalent saves $X"), and match-review assistance.
7. **Premium tier.** Unlimited alerts, household sharing, multi-metro, advanced exports, ad-free.
8. **Platform.** PWA/offline list mode, push and email notifications, native wrappers, and metros beyond DFW.

---

## Appendix A: DDL (PostgreSQL 16+; identical to `docs/schema.sql`)

```sql
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
```
