# Smart Grocery Saver — Product & Technical Spec

**Status:** Phase 0 draft for review · **Date:** 2026-11-16 · **Launch market:** Dallas–Fort Worth (DFW)

Smart Grocery Saver helps budget-conscious families cut grocery spend by **10–25%**. It compares prices across
**Walmart, Costco, Sam's Club, Target, Kroger, H-E-B and Aldi**, and decides whether one store or a multi-store run
is worth the drive.

Open questions and assumptions are in [`OPEN_QUESTIONS.md`](./OPEN_QUESTIONS.md). Where this spec makes a call that is
really yours to make, it is marked **[A-n]** (assumption) or **[Q-n]** (open question) with the same number used there.

---

## 1. MVP scope

### 1.1 In scope (Phases 1–7)

| Area | MVP capability |
|---|---|
| Accounts | Email/password sign-up and login. Google OAuth, with a local mock consent screen when credentials are absent. Refresh-token sessions and protected routes. Onboarding: ZIP, stores, memberships, vehicle MPG, "usual store". |
| Catalog | ≥150 canonical products in ~14 categories. Each is matched to package-level store items at all 7 chains. Search by name or alias. |
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
- **Performance (seeded data, laptop, warm DB):** a 50-item list's comparison returns in under 300 ms (p95). The optimizer runs in under 500 ms with 7 stores and max 3 stops. Product history (365d) returns in under 150 ms.
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

Membership stores (Costco, Sam's) are excluded unless `user_stores.has_membership` is true **[Q-3]**. Disabled stores
are always excluded. A store with no eligible item gets a line marked `missing`. Its total is flagged "incomplete" and it
is never shown as the cheapest store for the full list. The UI offers "cheapest with N items missing" as a secondary sort.

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

### 2.6 PriceProvider contract (`apps/api/src/providers`)
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
| Kroger | 1.00 (reference) | ~95% | weekly ad (Wed–Tue), 20–35% off, ~12% of items |
| Target | 1.03–1.08 | ~85% | weekly Circle deals (Sun–Sat) |

\*Index of a chain's per-unit regular price vs. Kroger for the same product.

Other seeded behaviour:
- **Seasonality:** produce varies ±15–30% sinusoidally by type (berries cheap Jun–Aug, citrus cheap Dec–Feb). Turkey is cheap in November. Baking goods go on sale in December. Grilling meats go on sale May–Jul.
- **Shocks:** eggs get one +40% supply shock lasting about six weeks.
- **Drift:** about +2.5% per year.

**Acceptance check:** the "Typical DFW family week" fixture list (35 items) shows a 10–25% saving between the best multi-store plan and the Kroger and Target baselines.

---

## 3. Architecture

```
apps/web     React 18 + Vite + TS + Tailwind + React Router + TanStack Query + Recharts
apps/api     Express 5 + TS, layered: routes → services → repositories (Drizzle) ; providers/ ; jobs/
packages/core     pure TS domain: units, size parser, matching scoring, comparison, optimizer, money
packages/shared   Zod schemas = API contract (request/response types for web & api)
packages/db       Drizzle schema, SQL migrations, seed (via MockPriceProvider), test DB helpers
e2e/              Playwright
```
- **ORM: Drizzle (recommended over Prisma).** The schema leans on Postgres features: generated columns, `daterange` with an exclusion constraint, a trigger, `pg_trgm`, `citext`, and window queries for historic lows. Drizzle is SQL-first and handles these as first-class SQL or custom migrations, without a Rust engine or codegen step. Its query builder also stays close enough to SQL for the comparison and history queries. Prisma would need `Unsupported(...)` fields and raw SQL for most of the interesting parts. **[Q-1]** confirms this choice.
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
| `stores`, `store_locations` | 7 chains; ~3–5 mock DFW locations each with lat/lng | `slug` unique |
| `users`, `auth_identities`, `sessions` | accounts, Google identities, refresh-token families | `email citext` unique; `(provider, subject)` unique |
| `user_stores` | per-user enabled stores, memberships, preferred location | PK `(user, store)` |
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

**Savings definition [Q-2]:** `baseline_total` is what the same list costs at the user's **baseline store**, using the same coverage rules at the same `price_as_of`. `savings = baseline − (items + fuel)`. Only committed trips count. Savings can be negative and are shown honestly.

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
| GET / PUT | `/me/stores` | 🔒 enabled, hasMembership, preferredLocationId per store |
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
| POST | `/trips` | 🔒 commit a plan `{listId, planId \| plan, shoppedOn}`. The server recomputes the plan at `price_as_of` and snapshots it, so client totals are never trusted |
| GET | `/trips`, `/trips/:id` | 🔒 |
| DELETE | `/trips/:id` | 🔒 |
| GET | `/dashboard/summary?from=&to=` | 🔒 KPIs: totalSavedCents, avgSavingsPct, tripCount, bestStore, fuelSpentCents |
| GET | `/dashboard/series?metric=savings\|spend&interval=week\|month&from=&to=` | 🔒 |
| GET | `/dashboard/breakdown?by=store\|category&from=&to=` | 🔒 |
| GET | `/exports/savings.csv?from=&to=` | 🔒 one row per trip item |
| GET | `/exports/savings.pdf?from=&to=` | 🔒 summary + KPI table + per-trip table (server-rendered, `pdfkit`) |

### Optimizer
| Method | Path | Notes |
|---|---|---|
| POST | `/lists/:id/optimize` | 🔒 body `{maxStores: 1..3, origin?: {lat,lng}, mpg?, fuelCentsPerGal?, timeValueCentsPerHour?, minutesPerStop?}` → `{single: Plan, multi: Plan[], recommendation}`. Each Plan: stores, ordered route, per-item assignment, itemsCents, distanceMiles, fuelCents, timeCents, totalCents, savingsVsBaselineCents, missing[] |

**Optimizer algorithm (exact):** E = eligible chains, |E| ≤ 7, using each chain's nearest or preferred location.
1. For every subset S ⊆ E with |S| ≤ maxStores (≤ 63 subsets for maxStores = 3), assign each item to its cheapest line in S. With S fixed, items are independent, so this step is exact.
2. Compute the cheapest round-trip route home → S → home by brute force.
3. Plan total = items + fuel + time.
4. Rank plans, preferring complete ones. The recommendation is multi-store only if it beats the best single store by ≥ max($3, 3%) **[Q-4]**.

---

## 6. Screens (mobile-first, 360px design width; ≥1024px gets a two-pane layout)

Global shell:
- **Top bar:** title, dark-mode toggle, notifications bell with unread count.
- **Bottom tab bar on mobile, left rail on desktop:** Lists · Compare · Deals/History · Dashboard · Settings.
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
S11 Settings: profile, ZIP, stores & memberships, vehicle/fuel, time value, baseline store, theme, log out.
S12 Templates: system + mine; preview; "Use template".   S13 Trip history/detail: snapshot of a committed plan.
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
- Seed: 7 stores, ~25 DFW mock locations, ~14 categories, **≥150 products**, all 7 stores, **12 months** of periods.
- API `/health` and `/health/ready`. The web app shell renders and shows API health. Dark-mode toggle works.
- `scripts/verify.sh` and a GitHub Actions workflow that runs it with a Postgres service.

**Acceptance:**
1. From a fresh clone, `pnpm i && pnpm db:up && pnpm db:reset && pnpm dev` produces a web app on :5173 showing "API: ok" and an API on :4000 where `/health/ready` returns 200.
2. Seed is deterministic: two runs with the same `SEED`/`SEED_ANCHOR_DATE` produce identical row hashes. It finishes in under 60 s.
3. Seed coverage tests confirm the following.
   - ≥150 products. Every chain has items.
   - Every product has items at ≥4 chains.
   - Every item has continuous coverage over 365 days, with no gaps or overlaps.
   - Each chain has ≥1 sale per month.
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
3. No password hashes or tokens ever appear in responses or logs (log redaction test).
4. Playwright: register → onboarding → land on Lists. Logout → protected URL redirects to login. Login with Google (mock).

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
   - Membership exclusion.
   - Missing items mark the store incomplete.
   - Ties.
   - Half-even rounding.
2. Property tests (fast-check):
   - The cheapest store total ≤ every complete store total.
   - Doubling the quantity never decreases cost.
   - Savings % is in [−∞, 100).
3. API: golden-file comparison for the family fixture at a pinned `asOf`. p95 < 300 ms over 50 runs.
4. Playwright: list → Compare shows the cheapest store with a star icon and text (not colour only). Percentages match the API. Toggling a store off recomputes.

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
3. Performance: 100-item list, 7 stores, maxStores 3 runs in under 500 ms p95.
4. Playwright: optimize → choose the multi-store plan → "I shopped this" → dashboard total increases by the plan's savings.

---

## 8. Roadmap (post-MVP, not scheduled)
1. **Real price providers.** Retailer APIs, licensed data feeds, and receipt/flyer ingestion. Comes with a legal/ToS review **[Q-8]** and a matching review admin UI.
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
  slug                 text NOT NULL UNIQUE,          -- 'walmart','costco','sams','target','kroger','heb','aldi'
  name                 text NOT NULL,
  requires_membership  boolean NOT NULL DEFAULT false,
  membership_fee_cents integer CHECK (membership_fee_cents >= 0),
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
  vehicle_mpg         numeric(4,1) NOT NULL DEFAULT 25.0 CHECK (vehicle_mpg > 0),
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
  has_membership        boolean NOT NULL DEFAULT false,
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
  member_only           boolean NOT NULL DEFAULT false,
  source                text NOT NULL,                 -- provider id: 'mock'
  observed_at           timestamptz NOT NULL DEFAULT now(),
  CHECK (sale_price_cents IS NULL OR sale_price_cents < regular_price_cents),
  CHECK ((sale_price_cents IS NULL) = (promo_type = 'none')),
  EXCLUDE USING gist (
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
  error                text
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
