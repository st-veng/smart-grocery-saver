# Assumptions & Open Questions

Numbers are referenced from SPEC.md as **[A-n]** / **[Q-n]**. Each open question lists the default I will build
if you don't answer. Decided questions are struck through and kept for the record. None of the remaining open questions block Phase 1.

## Open questions

| # | Question | Default if unanswered |
|---|---|---|
| Q-1 | ~~ORM: Drizzle or Prisma?~~ | **Decided:** Drizzle |
| Q-2 | ~~Savings baseline?~~ | **Decided:** the user's usual store. If unset, the median-priced enabled store |
| Q-3 | ~~Warehouse clubs without a membership?~~ | **Decided:** never greyed out. Member clubs count like any store. Non-member clubs are omitted from comparisons and plans but stay toggleable in Settings. Demo/e2e user has a Costco membership (Sam's off) |
| Q-4 | **Multi-store recommendation threshold:** recommend the extra stop only if it saves at least max($3, 3%) after fuel. Is that the right bar? Should time cost be on by default? | Use that threshold. Time cost is opt-in (default $0/hr; 10 min per stop when enabled) |
| Q-5 | **Sessions:** the spec uses a JWT access cookie plus a rotating DB-backed refresh token. A plain server-side session cookie would be simpler with equal security for a single web client. Which do you prefer, given native apps are on the roadmap? | JWT + refresh (native-friendly) |
| Q-6 | **Password reset and email verification:** in MVP or not? Either needs an email provider. | Out of MVP. Add a dev-console mailer stub in Phase 2 only if you want reset |
| Q-7 | **Historic-low rule:** should an alert fire only when the price is *strictly* below the prior 365-day low, or also when it *ties* the low? Is the low per product across stores, or per store? | Strictly lower. Per product, across the user's eligible stores, using unit price |
| Q-8 | **Real data later:** do you already have a data source in mind (retailer partner APIs, a licensed aggregator, receipt crowdsourcing)? Scraping retailer sites likely violates their ToS. This affects how the provider interface handles auth and rate limits. | Interface stays provider-agnostic. No scraping code |
| Q-9 | ~~Real brand names in mock data?~~ | **Decided:** real store-brand names with mock prices, plus a "Demo prices" banner |
| Q-10 | **Households:** one account per family, or shared lists between family members in MVP? | One account. Sharing is roadmap |
| Q-11 | **Deployment target:** where does this run beyond local and CI (Fly, Render, AWS)? This only affects Phase 1 config, such as the Dockerfile. | Local + CI only. A Dockerfile is added but not deployed |
| Q-12 | **Analytics and telemetry:** any product analytics in MVP? | None |
| Q-13 | ~~Kroger card prices: member-only like Tom Thumb, or ordinary sales?~~ | **Decided:** member-only Kroger Plus Card prices (ad prices and digital coupons), counted by default |
| Q-14 | ~~Store pre-selection rule?~~ | **Decided:** pre-select chains with a location within 7 mi of the user's home. Reference/demo origin is Main St & Preston Rd, Frisco TX. SPEC §2.7 |

## Assumptions

| # | Assumption |
|---|---|
| A-1 | MVP is a responsive web app. "Mobile-first" means 360px design width and a PWA install later. No native app. |
| A-2 | Sales tax is ignored. Texas exempts most grocery food items, so comparisons are pre-tax and say so. |
| A-3 | Prices are in-store, not delivery/pickup. **Loyalty member prices count by default** (decided): Tom Thumb for U and Kroger Plus Card prices (including Kroger digital coupons) are member-only periods. They apply when the user's loyalty card is on, which it is by default. Users can turn it off per store. |
| A-4 | Prices are metro-wide per chain in MVP. The schema supports per-location prices without migration. |
| A-5 | You pay for whole packages. The comparison rounds up to whole packages (honest bulk-pack math) and reports unit price separately. |
| A-6 | One metro (DFW). `metro` columns exist everywhere prices or locations live, so adding metros is data, not schema. |
| A-7 | "Today" and all price dates use America/Chicago. |
| A-8 | Geocoding uses a bundled table of DFW ZIP centroids. There is no external geocoding API, and users can't pick an exact address in MVP. Distances for the 7-mile pre-selection are measured from the ZIP centroid, so they can be off by about 1–2 miles. |
| A-9 | Distance = haversine × 1.25 circuity factor. There is no routing API, and the map is a list of stops, not an interactive map. |
| A-10 | Fuel default is $2.79/gal (env-configurable, user-overridable) and MPG defaults to 25. |
| A-11 | Mock store locations use real DFW suburbs with approximate coordinates and are labelled "(mock)". They are not claims about real store addresses. |
| A-12 | In-app notifications only. No email, SMS or push in MVP. |
| A-13 | The seed covers ~14 categories. Fresh produce and meat include per-weight items, and nothing is substituted across products automatically. "Store-brand equivalent" suggestions are roadmap. |
| A-14 | English only, USD only, US customary units with metric parsing supported. |
| A-15 | Postgres 17 runs in docker-compose. The CI service also uses 17. The DDL was validated on 16, and nothing in it is 17-specific. |
| A-16 | Trader Joe's and Sprouts carry a narrower assortment, so they will often be "incomplete" for a full list. They are never shown as cheapest for the whole list when items are missing, but they can win individual items and appear in multi-store plans. |
| A-17 | "Main St & Preston Rd, Frisco" means the intersection point (≈ 33.1500, −96.8065, confirmed in Phase 1 from nearby address geocodes). It is the default origin, the demo user's home and the e2e fixture home. It is **not** a fixed centre for every user: each user's 7-mile radius is measured from their own home. |
