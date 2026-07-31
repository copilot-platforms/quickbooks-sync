# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this app is

A multi-tenant Next.js (App Router) service that synchronizes Copilot / Assembly workspaces with QuickBooks Online (QBO). It runs on Vercel, persists state in Postgres (Supabase in prod, Drizzle ORM throughout), and reacts to Copilot webhooks (`invoice.created/updated/paid/voided/deleted`, `product.updated`, `price.created`, `payment.succeeded`) by mirroring those entities into the corresponding QBO realm.

A "portal" is one Copilot/Assembly workspace bonded to one QuickBooks realm. Almost every table is keyed by `portalId`; almost every service derives `this.user.workspaceId` from the request token and scopes everything to that portal.

## Common commands

Package manager is **Yarn 4 (Berry)**, Node **22.14.0** (`.nvmrc`).

```bash
yarn install                       # install
yarn dev                           # Next dev (Turbopack)
yarn build                         # next build (CI uses build.sh which also runs drizzle-kit migrate)
yarn lint:check                    # ESLint over src/ and test/
yarn prettier:check                # Prettier check
yarn lint:fix                      # ESLint --fix
yarn prettier:fix                  # Prettier write

# Tests (Vitest, two projects defined in vitest.config.ts)
yarn test                          # both: unit then integration (groupOrder enforces this)
yarn test:watch                    # watch
yarn test:coverage                 # v8 coverage
npx vitest run --project unit                                   # only unit
npx vitest run --project integration                            # only integration
npx vitest run test/integration/quickbooks/priceCreated/happyPath.test.ts   # single file
npx vitest run -t 'happy path'                                  # by test-name pattern

# Trigger.dev (background task runtime)
yarn trigger:dev                   # local dev worker
yarn trigger:deploy                # deploy tasks

# DB migrations (Drizzle Kit, schema lives at src/db/schema/)
npx drizzle-kit generate           # create new migration from schema changes
npx drizzle-kit migrate            # apply pending migrations to DATABASE_URL

# One-off operational scripts (tsx, see src/cmd/*)
yarn cmd:rename-qb-accounts
yarn cmd:backfill-product-info
yarn cmd:sync-missed-invoices
yarn cmd:sync-missed-products
```

Husky `pre-commit` runs `lint-staged` (eslint --fix + prettier --write on `src/**/*.{ts,tsx}`). CI (`.github/workflows/test.yml`) runs `yarn test` on PRs; `.github/workflows/lint.yml` runs lint+prettier on every push. CI assumes the testcontainers Postgres image is available (Docker is preinstalled on `ubuntu-latest`).

## Architecture

### Request → handler shape

Every API route follows the same skeleton:

```
src/app/api/<area>/<feature>/
  route.ts                # exports { POST/GET } = withErrorHandler(controllerFn); sets maxDuration
  <feature>.controller.ts # auth + Sentry scope + parse + delegate to service
  <feature>.service.ts    # extends BaseService; orchestrates DB + external APIs
```

Controllers call `authenticate(req)` (`src/app/api/core/utils/authenticate.ts`), which reads `?token=…`, asks Copilot to decrypt it, and returns a `User` (`src/app/api/core/models/User.model.ts`). `User` carries `workspaceId` (= portalId), role, and the lazily-attached `qbConnection` (service-item / client-fee refs).

`withErrorHandler` (`src/app/api/core/utils/withErrorHandler.ts`) is the **only** error path. It maps `ZodError` / `APIError` / `CopilotApiError` / `RetryableError` / Intuit OAuth + Axios errors to HTTP responses and forwards categorized exceptions to Sentry. Don't add try/catch in route handlers — throw and let this wrapper format.

### BaseService and the DB singleton

Services extend `BaseService` (`src/app/api/core/services/base.service.ts`), which holds:

- `this.db` — the **module-level Drizzle singleton** from `src/db/index.ts` (`DBClient.getInstance()`); `casing: 'snake_case'`.
- `this.user` — the authenticated `User` for the request.
- `setTransaction(tx)` / `unsetTransaction()` — swap `this.db` for a transaction handle inside a `db.transaction(...)` callback, then restore.

**Pitfall (known, see `memory/project_unsetTransaction_bug.md`):** `unsetTransaction()` is sometimes called inside the transaction callback or skipped on error paths — across `BaseService` subclasses this leaves the singleton pointed at a closed tx. When introducing or modifying transactional code, audit that `setTransaction` / `unsetTransaction` are paired in `try/finally` and that nested service calls share the tx handle.

The DB singleton is also why test helpers (`test/helpers/seed.ts`, `test/helpers/testDb.ts`) import `@/db` directly — see `docs/why-test-helpers-use-the-app-db-singleton.md`. Don't introduce a separate test-only Drizzle client; tests must read what the app writes.

### Webhook flow (the central path)

`POST /api/quickbooks/webhook` → `WebhookService.handleWebhookEvent` (`src/app/api/quickbooks/webhook/webhook.service.ts`) is a switch on `payload.eventType` that dispatches to `InvoiceService` / `ProductService` / `PaymentService`. A few things to know before changing it:

1. **Idempotency is enforced via `qb_sync_logs` claim rows.** `SyncLogService.claimWebhookEvent({ copilotId, entityType, eventType, … })` returns `{ claimed: false }` if a row already exists; handlers exit early. Any new webhook handler must call `claimWebhookEvent` before doing real work or duplicate processing will leak into QBO.
2. **`qb_sync_logs.quickbooks_id` is polymorphic.** Its meaning depends on `(entityType, eventType)` — for `INVOICE/PAID` it stores the QBO **Payment** ID, not the Invoice ID. See `memory/project_qb_sync_logs_semantics.md`.
3. **Pre-claim sleeps for ordering.** `INVOICE_UPDATED` / `INVOICE_VOIDED` / `PAYMENT_SUCCEEDED` sleep before `claimWebhookEvent` so a companion event (e.g., `INVOICE_CREATED`) can claim first. The `delayMs` lives in the handler, not the caller — keep it that way; moving the sleep after the claim re-opens the race.
4. **Setting flags gate handlers.** `PRICE_CREATED` / `PRODUCT_UPDATED` no-op when `createNewProductFlag` is false; `PAYMENT_SUCCEEDED` no-ops when `absorbedFeeFlag` is false or there's no platform-paid fee. Read `qb_settings` via `SettingService` rather than passing flags around.
5. **There's a known TOCTOU race on `claimWebhookEvent`** — accepted, parked, will be addressed with an advisory lock + dedupe job, not a rewrite. See `memory/project_qb_sync_logs_toctou_parked.md`.

### Token refresh

QBO access tokens expire in ~1h, refresh tokens in ~100 days. `src/utils/intuitAPI.ts` sends authenticated requests; `src/utils/tokenRefresh.ts` (`getValidQbTokens`) refreshes when stale. The `vercel.json` cron `/api/quickbooks/refresh-tokens` runs daily at 06:00 UTC to keep refresh tokens warm. There's a known silent-401 bug — expired tokens cause `null` returns from `getFetchWithHeader/postFetchWithHeaders`; the planned fix is auto-refresh inside those helpers (design at `docs/intuit-api-token-refresh.md`, summary in `memory/project_intuit_api_token_refresh.md`).

### Background work

- **Vercel crons** (`vercel.json`):
  - `/api/quickbooks/cron` every 12h — kicks off `processResyncForFailedRecords` (Trigger.dev task) to retry failed sync logs. Auth via `Bearer ${CRON_SECRET}`.
  - `/api/quickbooks/refresh-tokens` daily 06:00 UTC.
- **Trigger.dev** tasks live in `src/trigger/` (config at `trigger.config.ts`, runtime: node, default 3 retries, `maxDuration: 3600s`). Sentry source maps are uploaded only when `VERCEL_ENV === 'production'`.

## Multi-tenancy invariant

Every `WHERE` clause that touches a portal-scoped table needs `portalId = this.user.workspaceId`. Forgetting this leaks one tenant's data into another. The unique indexes on `qb_sync_logs` and `qb_invoice_sync` (see migrations 20260427100328 / 20260427055352) enforce some of this at the DB level, but most of it is service-layer discipline.

## Database & schema

- Drizzle schemas in `src/db/schema/*` registered in `src/db/schema/index.ts`. Relations in `relation.ts`.
- Migrations in `src/db/migrations/` (prefix `supabase`, generated by drizzle-kit). The `init.sql` (20250701) defines all enums; subsequent files alter.
- Custom column helpers in `src/db/helper/column.helper.ts` (`timestamps`) and enum bridge in `drizzle.helper.ts` (`enumToPgEnum`).
- `qb_payments` table exists but is currently unused (reserved for future) — no rows in prod. See `memory/project_qb_payments_unused.md`.
- Type-safe Zod schemas come from `drizzle-zod` (`createInsertSchema` / `createSelectSchema`); reuse those rather than hand-rolling Zod for DB rows.

## Testing

- Two Vitest **projects** in `vitest.config.ts` — `unit` (mock-heavy, isolated) and `integration` (real Postgres via testcontainers). Run order is enforced via `sequence.groupOrder` (unit=0, integration=1).
- Integration project is configured **`pool: 'forks'` + `fileParallelism: false` + `isolate: false`** so all integration tests share one Postgres container _and_ one app DB connection. Don't change these without reading `docs/vitest-gotchas.md` and `docs/why-test-helpers-use-the-app-db-singleton.md`.
- `.env.test` is loaded by `test/integration/globalSetup.ts` with `override: true` so a developer's local `.env` can't leak into tests. `DATABASE_URL` is intentionally **not** in `.env.test` — globalSetup sets it from the container's URI before any worker imports `src/config`.
- Module mocks for integration are in `test/integration/setup.ts` — `@/utils/copilotAPI`, `@/utils/intuitAPI`, and `@sentry/nextjs` must be mocked with **explicit factories** (and Intuit/Copilot mock implementations must use `function`, not `=>`, because the code does `new IntuitAPI(...)`). See `docs/vitest-gotchas.md` items 1–3.
- Test helpers in `test/helpers/`: `seed.ts` (`seedHealthyPortal`, `TEST_PORTAL_ID`, etc.), `webhook.ts` (`postWebhook` via `next-test-api-route-handler`), `testDb.ts` (`truncateAllTestTables`).
- Test-data philosophy in `docs/test-data-dos-and-donts.md`: static fixtures for the thing under test, factories with explicit overrides for single-dimension variants, **no faker** in fixtures or assertions.

## Path aliases

```
@/*      → src/*
@test/*  → test/*
```

Configured in `tsconfig.json` and propagated to Vitest via `vite-tsconfig-paths` (per-project in `vitest.config.ts`).

## Style notes

- Prettier: single quotes, no semis, trailing comma all (`.prettierrc`).
- ESLint: `next/core-web-vitals` + TypeScript; `prefer-const` and `no-var` are errors; unused-var underscore prefix is exempt; `@typescript-eslint/no-explicit-any` is disabled (the codebase uses `any` deliberately at framework boundaries).
- Tailwind v4 + `copilot-design-system`. UI surface is small (settings dashboard + OAuth callback) — most work happens in the API/service layer.
- The `docs/` folder is **gitignored** (per `.gitignore`) and used for local decision notes — design docs, post-mortems, comparison tables. Save non-trivial tradeoff discussions there rather than in code comments or commit messages.

## Things to read before non-trivial changes

- `docs/testcontainers-vs-local-supabase.md` — why integration tests use testcontainers, not the local Supabase stack.
- `docs/why-test-helpers-use-the-app-db-singleton.md` — why test helpers import `@/db` and what would break if you opened a separate client.
- `docs/vitest-gotchas.md` — the five real traps already hit in this project.
- `docs/test-data-dos-and-donts.md` — the test-data rules.
- `docs/intuit-api-token-refresh.md` — design for the silent-401 fix.

## What this repo doesn't have

- No design system / shared component library — UI is a thin dashboard, mostly settings forms.
- No GraphQL, no tRPC — plain Next.js Route Handlers + service classes.
- No DI container — `BaseService` reads `db` from a module singleton; tests work _with_ that constraint, not around it.
- No existing CLAUDE.md until this one.

## Engineering notes

- After a successful implementation, the changes will be reviewed by the team lead and greptileAI in github.
- Do not use let unless absolutely necessary. Use const instead.
- Always keep the comments short, on point and easy to understand with easy wordings. This is must.
- Follow DRY, KISS, SOLID, YAGNI principles.
