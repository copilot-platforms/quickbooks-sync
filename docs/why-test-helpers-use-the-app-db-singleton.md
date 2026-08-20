# Why `truncateAllTestTables` (and other test helpers) import the real app `db`

**Date:** 2026-04-13
**Context:** Reviewing the integration test scaffolding for `price.created`, the question came up: why does `test/helpers/testDb.ts` import `@/db` — isn't that the production-style module-level singleton? Shouldn't tests use a dedicated test client?

## Short answer

An integration test's contract is: **"the app's code runs against a real Postgres, and we verify observable outcomes in that Postgres."** That requires the test and the app to talk to the _same_ database through the _same_ client. Using a separate test-only DB client would silently decouple "what the test wipes / seeds / asserts on" from "what the app writes to", which defeats the purpose.

## Data flow on one test run

```
globalSetup.ts        → starts Postgres container, sets process.env.DATABASE_URL
  ↓
test file imports @/db → DBClient.getInstance() constructs once,
                         reads DATABASE_URL = container URL,
                         opens a postgres-js connection pool
  ↓
beforeEach → truncateAllTestTables() uses db → wipes the container's tables
             seedHealthyPortal()          uses db → inserts into the container
  ↓
POST /api/quickbooks/webhook
  ↓ controller → service code also imports @/db (SAME singleton)
    → reads the seed, writes qb_product_sync, writes qb_sync_logs
  ↓
test assertions: db.select(...) → SAME singleton, SAME container,
                                  reads back what the app wrote
```

If `truncateAllTestTables` used a _different_ Drizzle client, we'd get a subtle bug: truncate wipes DB "A", app writes to DB "B", assertions check DB "A" and see nothing. Tests pass when they shouldn't, or fail for mysterious reasons.

## Why the singleton isn't a risk here

Normally, a module-level singleton pointing at a DB is something to be nervous about in tests — it implies "shared state across everything, hard to override." Two things make it fine in this setup:

1. **Only one DB is reachable from this process.** `DATABASE_URL` is set by `globalSetup.ts` to the testcontainer's URI _before_ any `src/` code is imported by the test worker. The singleton can't bind to anything else. No production DB is reachable.
2. **Tests run sequentially.** `vitest.config.ts` sets `fileParallelism: false` and `isolate: false` for the integration project, so no two tests mutate the shared DB concurrently. Truncate + seed in `beforeEach` is enough to guarantee a clean slate.

## Alternatives we considered and rejected

| Approach                                                             | Why not                                                                                                                                                                                                                                                                                      |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `truncateAllTestTables` uses its own `drizzle(postgres(url))` client | Two connection pools to the same DB — works, but pointless; also re-raises the "was URL set in time?" ordering question                                                                                                                                                                      |
| Truncate via raw `psql` in a shell script before Vitest starts       | Runs once, not per-test; doesn't reset between tests                                                                                                                                                                                                                                         |
| `BEGIN`/`ROLLBACK` wrapping each test instead of truncate            | Cleaner in theory, but **doesn't work for this codebase** — `BaseService.setTransaction()` opens its own transaction, and Postgres doesn't allow nested real transactions (only savepoints). Rolling back at the test level would abort the app's transaction mid-flight and mask real bugs. |
| A separate test-only Drizzle client with its own schema imports      | Adds a second pool for no benefit; more chances for the two to drift (casing, schema refs, pooling behavior)                                                                                                                                                                                 |

The simplest correct answer is: **use the same `db` the app uses**. That's what integration testing means.

## Future consideration: DI refactor

This pattern works _because_ `@/db` is a singleton. If the codebase ever moves to dependency injection (the 3–5 week refactor noted in the testing-strategy memory), these helpers would change shape — they'd accept a `db` argument rather than importing it. At that point `truncateAllTestTables(db)` becomes natural and the "why is it importing app code" question goes away.

Until then, the singleton is a constraint we work _with_, not against.

## TL;DR for future-me

- Tests and app must share the DB client. Do **not** open a second Drizzle/postgres-js client just for the test.
- The singleton is safe because `DATABASE_URL` is fixed to the container before any `src/` import loads.
- Keep integration tests sequential (`fileParallelism: false`, `isolate: false`) as long as they share a container.
- If you're tempted to switch to `BEGIN/ROLLBACK` for isolation: check that no code under test opens its own transaction first. In this codebase, `BaseService.setTransaction()` does — so truncate is the right tool.
