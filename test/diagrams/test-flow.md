# Test execution flow

High-level diagrams of how unit and integration tests run in this repo. Aimed at a new engineer onboarding to the test suite.

Source of truth for the wiring shown here:
- `vitest.config.ts` (two projects: `unit`, `integration`)
- `test/integration/globalSetup.ts` (Testcontainers + migrations)
- `test/integration/setup.ts` (shared mocks for outbound APIs)
- `test/helpers/*` (`seed.ts`, `testDb.ts`, `webhook.ts`, `invoiceCreatedTestSetup.ts`, `mocks.ts`)

Legend used in every diagram:
- **Blue** = real infrastructure (Postgres in a container).
- **Orange** = mocked at the module boundary; no real network call leaves the process.

---

## Unit tests

No container, no migrations, no HTTP layer. Each test file owns its mocks at the top of the file and instantiates the unit under test directly.

```mermaid
flowchart TD
    A["yarn test<br/>(Vitest)"] --> B["Unit project<br/>environment: node<br/>NO globalSetup, NO setupFiles"]

    B --> C["Test file<br/>e.g. test/unit/api/quickbooks/webhook/handleInvoiceCreated.test.ts"]
    C --> D["Per-file vi.mock(...) at top of file<br/>(every external boundary stubbed)"]

    D --> D1["vi.mock @/db<br/>(no real Postgres at all)"]
    D --> D2["vi.mock @/utils/copilotAPI"]
    D --> D3["vi.mock @/utils/intuitAPI"]
    D --> D4["vi.mock @sentry/nextjs"]
    D --> D5["vi.mock @/utils/logger / sleep / auth"]

    D1 --> E["beforeEach<br/>reset spies, wire return values"]
    D2 --> E
    D3 --> E
    D4 --> E
    D5 --> E

    E --> F["Instantiate the unit under test directly<br/>e.g. new WebhookService(mockUser)"]
    F --> G["Call the method<br/>service.handleWebhookEvent(payload)"]

    G --> H1["Mocked DB calls → return canned rows"]
    G --> H2["Mocked Copilot/Intuit clients → return canned data or throw"]

    H1 --> I["Assertions"]
    H2 --> I
    I --> I1["expect(returnValue)"]
    I --> I2["expect(mockFn).toHaveBeenCalledWith(...)"]

    style D fill:#ffd6a5,stroke:#bc6c25
    style D1 fill:#ffd6a5,stroke:#bc6c25
    style D2 fill:#ffd6a5,stroke:#bc6c25
    style D3 fill:#ffd6a5,stroke:#bc6c25
    style D4 fill:#ffd6a5,stroke:#bc6c25
    style D5 fill:#ffd6a5,stroke:#bc6c25
```

Reading guide:
- Unit tests never reach `route.ts` or Drizzle.
- Each unit test file owns its mock declarations (this is the opposite of integration, where mocks are centralized in `setup.ts`).
- The unit-under-test is constructed directly with a fake `User` and called as a plain function; assertions are on its return value and on the recorded calls to the mocked dependencies.

---

## Integration tests

Two full vertical flows shown side by side. **Left column** runs once per `yarn test`; **right column** runs for each `it`. Read each column top-to-bottom independently. No edge connects the two — Part 1 simply leaves the worker in a state Part 2 can use.

```mermaid
%%{init: {"flowchart": {"defaultRenderer": "elk"}}}%%
flowchart LR
    subgraph Bootstrap["Part 1 — Bootstrap (runs once)"]
        direction TB
        A["yarn test<br/>(Vitest)"]
        B["Integration project<br/>pool: forks · fileParallelism: false · isolate: false"]
        C["globalSetup.ts"]
        C1["Testcontainers<br/>PostgreSqlContainer('postgres:16-alpine')"]
        C2["drizzle-orm/migrator<br/>applies src/db/migrations/*"]
        C3["process.env.DATABASE_URL =<br/>container.getConnectionUri()"]
        C4["dotenv loads .env.test<br/>(override: true)"]
        D["Single forked worker boots<br/>(inherits env vars)"]
        E["setupFiles → test/integration/setup.ts"]
        E1["vi.mock @/utils/copilotAPI"]
        E2["vi.mock @/utils/intuitAPI"]
        E3["vi.mock @/utils/intuit<br/>(pinned on globalThis)"]
        E4["vi.mock @sentry/nextjs"]
        R["Ready for test files"]

        A --> B --> C --> C1 --> C2 --> C3 --> C4 --> D --> E
        E --> E1
        E --> E2
        E --> E3
        E --> E4
        E1 --> R
        E2 --> R
        E3 --> R
        E4 --> R
    end

    subgraph PerTest["Part 2 — Per-test request flow (runs each it)"]
        direction TB
        F["Test file<br/>e.g. invoiceCreated/happyPath.test.ts"]
        G["setupInvoiceCreatedTest()"]
        G1["beforeEach:<br/>truncateAllTestTables()<br/>+ installMockApis()"]
        G2["afterEach:<br/>vi.clearAllMocks()"]
        H["Test body"]
        H1["seedHealthyPortal /<br/>seedProductSync<br/>(writes via @/db singleton)"]
        H2["postWebhook(payload)"]
        I["next-test-api-route-handler<br/>testApiHandler(...)"]
        J["Next.js route<br/>src/app/api/quickbooks/webhook/route.ts"]
        K["Controller → WebhookService<br/>→ Invoice/Product/Payment services"]
        L1[("Postgres in Testcontainer<br/>via @/db Drizzle singleton")]
        L2["MOCKED CopilotAPI"]
        L3["MOCKED IntuitAPI"]
        M["Response"]
        N["expect(status / DB rows / mock.calls)"]

        F --> G
        G --> G1
        G --> G2
        G1 --> H
        H --> H1
        H --> H2
        H2 --> I --> J --> K
        K --> L1
        K --> L2
        K --> L3
        L1 --> M
        L2 --> M
        L3 --> M
        M --> N
    end

    style C1 fill:#cfe8ff,stroke:#1e6091
    style L1 fill:#cfe8ff,stroke:#1e6091
    style E fill:#ffd6a5,stroke:#bc6c25
    style E1 fill:#ffd6a5,stroke:#bc6c25
    style E2 fill:#ffd6a5,stroke:#bc6c25
    style E3 fill:#ffd6a5,stroke:#bc6c25
    style E4 fill:#ffd6a5,stroke:#bc6c25
    style L2 fill:#ffd6a5,stroke:#bc6c25
    style L3 fill:#ffd6a5,stroke:#bc6c25
    style R fill:#e8e8e8,stroke:#555,stroke-dasharray: 4 3
```

Takeaways:
- **One container, one worker, one module registry** for the whole run. Outbound APIs (Copilot, Intuit, Sentry) are mocked once in Part 1 and every test file inherits those mocks.
- `pool: forks + fileParallelism: false + isolate: false` is what makes the shared module registry safe — see `docs/vitest-gotchas.md` for the traps that motivated those settings.
- The test hits the **real** Next.js route handler — middleware, Zod parsing, and `withErrorHandler` all execute. Only **outbound network** is faked; the database is real Postgres (blue).
- `truncateAllTestTables()` is what keeps a shared container safe across tests. If you add a new table to `src/db/schema/*`, add it to `test/helpers/testDb.ts` too.

---

## One-line summary

> Unit tests stub everything outside the function under test; integration tests stub only the **outbound** network (Copilot + Intuit + Sentry) and run the real route handler against a real Postgres started by Testcontainers.
