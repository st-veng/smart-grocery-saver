# CLAUDE.md — Smart Grocery Saver

Price-comparison app for budget-conscious DFW families (Walmart, Costco, Sam's Club, Target, Kroger, H-E-B, Aldi, Tom Thumb, Sprouts, Trader Joe's).
Read `SPEC.md` before any work. It is the source of truth for scope, data model, API and acceptance criteria.
`OPEN_QUESTIONS.md` tracks decisions awaiting the product owner.

## Working agreement
- **Work in phases (SPEC §7). Stop at the end of each phase for review. Never start the next phase without explicit approval.**
- **A phase is done only when `pnpm verify` passes: typecheck, lint, and ALL tests (unit, API, e2e).** No skipped
  or `.only` tests, no `@ts-expect-error`/`eslint-disable` without a comment explaining why.
- Every phase adds tests for what it builds, at the lowest layer that can prove it (core unit > API > e2e).
- If implementation diverges from SPEC.md, update SPEC.md in the same change and call it out in the phase report.
- One branch per phase: `phase-<n>-<slug>` (e.g. `phase-1-scaffold`). Conventional Commits (`feat(api): …`).

## Stack
| Layer | Choice |
|---|---|
| Runtime | Node 22 LTS, pnpm 10 workspaces (`packageManager` pinned), TypeScript 5.9 `strict`, ESM everywhere |
| Web | React 19, Vite 8, Tailwind CSS 4 (class-based dark mode via `@custom-variant`), React Router, TanStack Query, controlled forms validated with the shared Zod schemas, Recharts |
| API | Express 5, Zod validation, pino logging (redaction on), helmet, express-rate-limit, node-cron |
| DB | PostgreSQL 17 (docker-compose), **Drizzle ORM** + drizzle-kit migrations (custom SQL for functions/trigger/exclusion) |
| Auth | argon2id (`@node-rs/argon2`), JWT access cookie + rotating opaque refresh cookie, Google OIDC (PKCE) with mock mode |
| Export | `pdfkit` (PDF), hand-rolled RFC 4180 CSV writer with formula-injection escaping |
| Tests | Vitest 5 (unit + API + DB), Supertest (API), fast-check (property), Playwright 1.63 + @axe-core/playwright (e2e) |

**Pinned on purpose:**
- TypeScript 5.9: typescript-eslint doesn't support TS 7 yet.
- ESLint 9: eslint-plugin-jsx-a11y doesn't support ESLint 10 yet.
- `@playwright/test` 1.63.0: matches the preinstalled browsers. CI runs `playwright install chromium` and isn't affected by this pin.

Re-check these when upgrading.

## Folder structure
```
.
├── apps/
│   ├── api/                 Express app
│   │   ├── src/
│   │   │   ├── app.ts       createApp(deps) — no listen(); used by tests
│   │   │   ├── server.ts    listen + jobs
│   │   │   ├── config.ts    env parsed with Zod (fail fast)
│   │   │   ├── routes/      thin: parse (shared schema) → service → respond
│   │   │   ├── services/    business logic; no Express types
│   │   │   ├── repositories/ Drizzle queries only
│   │   │   ├── auth/        tokens, google (real + mock), middleware
│   │   │   └── jobs/
│   │   └── test/            *.api.test.ts (Supertest), helpers/
│   └── web/
│       └── src/{routes,components,features/<area>,lib,hooks,styles}
├── packages/
│   ├── core/                PURE domain logic, no I/O: units, parseSize, money, comparison, optimizer, geo
│   ├── shared/              Zod schemas + inferred types = API contract (used by api AND web)
│   ├── db/                  drizzle schema, migrations/, migrate/reset CLIs, test-database helpers (`@sgs/db/testing`)
│   └── pricing/             PriceProvider contract, MockPriceProvider, catalog/ (products, stores, fixtures),
│                            ingest/ (normalize → match → upsert → price periods), seed/
├── e2e/                     Playwright specs + fixtures
├── docs/schema.sql          reference DDL (SPEC Appendix A)
├── scripts/verify.mjs       the gate: typecheck → lint → test → e2e (db.mjs: db:up/db:down, cross-platform)
├── docker-compose.yml
└── .github/workflows/ci.yml
```
Dependency direction: `web → shared` · `api → shared, core, db, pricing` · `pricing → db, core` · `db → core` · `core → (nothing)`.
`core` must never import from `db`, `api`, Express, React, or Node I/O modules.

## Commands (run from repo root)
| Command | Does |
|---|---|
| `pnpm i` | install (frozen lockfile in CI) |
| `pnpm db:up` / `pnpm db:down` | start/stop Postgres on host port **5433**: docker compose, or a local PostgreSQL install when no Docker daemon is available |
| `pnpm db:generate` | generate a migration from Drizzle schema changes |
| `pnpm db:migrate` | apply migrations to `DATABASE_URL` |
| `pnpm db:seed` | wipe app data and seed via MockPriceProvider + the real ingestion pipeline (`SEED`, `SEED_ANCHOR_DATE` respected; ~17 s), then commit 24 demo trips for the dashboard |
| `pnpm db:reset` | drop + migrate + seed dev DB |
| `pnpm dev` | api (:4000, tsx watch) + web (:5173, Vite proxy `/api` → :4000) |
| `pnpm sim:advance [--days N \| --to YYYY-MM-DD]` | ingest the mock provider day by day from the latest market date and evaluate alerts (planted honey clearance at anchor+1 → 1-year-low demo) |
| `pnpm typecheck` | `tsc -p` in every package (`pnpm -r typecheck`) |
| `pnpm lint` / `pnpm lint:fix` | ESLint + Prettier check |
| `pnpm test` | unit + API + DB tests (Vitest) in every package; DB-backed suites create their own `sgs_test_<suite>` database |
| `pnpm test:unit` / `pnpm test:api` | subsets |
| `pnpm test:e2e` | Playwright: reseeds `sgs_e2e`, starts api on :4100 and a production web build on :4173 (proxying `/api`), runs mobile + desktop projects with traces off |
| `pnpm verify` | **the phase gate**: typecheck → lint → test → test:e2e; non-zero on any failure |

Filter to one package: `pnpm --filter @sgs/core test`. Single test file: `pnpm --filter @sgs/api test test/auth.api.test.ts`.

## Conventions
**TypeScript**
- No `any` (lint-enforced). Prefer `unknown` + Zod parse at boundaries. No non-null `!` outside tests.
- Named exports only. File names `kebab-case.ts`. React components `PascalCase.tsx`.
- Errors: throw `AppError(code, httpStatus, message, details?)`. A single Express error middleware maps errors to `{ error: { code, message, details } }`. Never leak stack traces or SQL.

**Domain rules (do not violate)**
- **Money is integer cents** (`Cents` branded type). Never use floats for currency totals. Round half-even, once, at the line total.
- **Quantities are stored in base units** (g, ml, ea). Convert only for display. The factor table in `packages/core/src/units/table.ts` and SQL `unit_factor()` must stay identical (a parity test enforces this).
- `oz` (mass) and `fl_oz` (volume) are distinct units. Never coerce one to the other.
- Unparseable sizes and low-confidence matches go to the review queue. Never guess.
- Price dates are `YYYY-MM-DD` in America/Chicago. Timestamps are UTC `timestamptz`.
- Warehouse clubs are never greyed out. With a membership they behave like any store. Without one they are omitted from comparisons and plans.
- Store-brand names are real; prices are mock, and the UI shows the "Demo prices" banner while `PRICE_PROVIDER=mock`.
- Member-only prices apply only to qualifying users: a paid membership (`has_membership`) or a loyalty card (`has_loyalty`, which defaults to true). Non-members pay the regular price for that period. Eligibility logic lives in `core` only.
- Comparisons always report **line cost** (packages actually bought) separately from **unit price**.

**API**
- Every route's request and response is a Zod schema in `packages/shared`. Routes `parse()` input, and tests validate output against the same schema.
- REST under `/api/v1`, camelCase JSON, cursor pagination. Return 404 (not 403) for other users' resources.
- Services receive dependencies (db, provider, clock) as arguments, so tests inject a fixed clock. No `Date.now()` in services or core.

**DB**
- snake_case in SQL, camelCase in TS. Every schema change ships as a migration. Never edit an applied migration.
- Write raw SQL (`sql\`\``) only in repositories, and parameterize it always.

**Web**
- Mobile-first. Design at 360px, then `md:`/`lg:` up. Every colour has a `dark:` counterpart.
- Server state lives in TanStack Query. No global client store unless justified.
- Accessibility: semantic elements, labelled inputs, focus-visible, 44px tap targets. Never signal with colour alone (cheapest = ★ + text).
- Every data view has loading, empty and error states.

**Tests**
- Unit tests are colocated as `*.test.ts` and are pure (no DB). DB tests are `*.db.test.ts` (or live in `packages/db`). API tests live in `apps/api/test/*.api.test.ts`. DB-backed suites get their own real Postgres database via `createTestDatabase(suffix)` from `@sgs/db/testing`. Each file runs in a transaction or truncates its tables, so there is no shared mutable state.
- DB-backed tests use a fixed `SEED`, `SEED_ANCHOR_DATE=2026-11-01` and an injected clock.
- e2e covers critical flows only (see SPEC §7). It uses role- and label-based selectors (`getByRole`) and no CSS selectors. Each spec runs axe and asserts zero serious or critical violations.

## Environment (`.env.example` is committed; `.env` is not)
`DATABASE_URL`, `DATABASE_URL_TEST`, `JWT_SECRET`, `COOKIE_SECURE`, `WEB_ORIGIN`, `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `AUTH_GOOGLE_MODE=mock|real`, `PRICE_PROVIDER=mock`, `SEED`,
`SEED_ANCHOR_DATE`, `FUEL_CENTS_PER_GAL_DEFAULT=279`, `METRO=DFW`, `PRESELECT_RADIUS_MILES=7`,
`DEFAULT_ORIGIN=33.1500,-96.8065` (Main St & Preston Rd, Frisco TX — demo/e2e user home), `DEMO_USER_PASSWORD` (dev seed only),
`AUTH_RATE_LIMIT_SCALE=1` (multiplies auth rate limits; e2e uses 50; must be 1 in production),
`ENABLE_TEST_HOOKS=false` (mounts `POST /api/v1/test/sim/advance`; e2e only; refused in production). Demo login:
`demo@sgs.test` / `demo-password-123` (seeded by `pnpm db:seed`).
Missing Google credentials ⇒ mock mode automatically; the API refuses to start with `AUTH_GOOGLE_MODE=mock` when
`NODE_ENV=production`.

## Phase report template (post at the end of every phase)
1. What was built, with links to the key files.
2. `pnpm verify` output summary: counts of passed tests per suite.
3. Deviations from SPEC and the resulting SPEC edits.
4. New or updated open questions.
5. Known gaps and what the next phase depends on.
