import { vi } from 'vitest'

/**
 * Shared module mocks for all integration tests.
 *
 * Loaded via `setupFiles` in vitest.config.ts (integration project). Each
 * test file still configures per-test behavior in beforeEach via
 * `vi.mocked(CopilotAPI).mockImplementation(...)`.
 *
 * Why here instead of per-file:
 * - Explicit factory for CopilotAPI/IntuitAPI avoids evaluating the real
 *   modules (copilot-node-sdk has an ESM directory-import that breaks).
 * - Sentry has to be stubbed because withRetry.ts calls
 *   `scope.addEventProcessor(...)` inside Sentry.withScope.
 *
 * Pin the vi.fn() factories on globalThis so multiple setupFile evaluations
 * under isolate:false reuse the same mock identity. See docs/vitest-gotchas.md.
 */

type MockSingletons = {
  CopilotAPI?: ReturnType<typeof vi.fn>
  IntuitAPI?: ReturnType<typeof vi.fn>
}
const g = globalThis as typeof globalThis & {
  __qbsync_test_mocks?: MockSingletons
}
g.__qbsync_test_mocks ??= {}
g.__qbsync_test_mocks.CopilotAPI ??= vi.fn()
g.__qbsync_test_mocks.IntuitAPI ??= vi.fn()

vi.mock('@/utils/copilotAPI', () => ({
  CopilotAPI: g.__qbsync_test_mocks!.CopilotAPI!,
}))

vi.mock('@/utils/intuitAPI', () => ({
  default: g.__qbsync_test_mocks!.IntuitAPI!,
  // Named export used by src/utils/error.ts to detect Intuit-sourced APIErrors
  // when unwrapping error messages in the webhook catch block.
  IntuitAPIErrorMessage: '#IntuitAPIErrorMessage#',
  // Named export consumed directly by controllers (e.g. bank-account) to
  // build a customQuery SELECT list. Must be kept in sync with the real
  // `QB_ACCOUNT_COLUMNS` in src/utils/intuitAPI.ts.
  QB_ACCOUNT_COLUMNS: ['Id', 'Name', 'SyncToken', 'Active', 'AccountType'],
}))

// `@/utils/intuit` is the OAuth wrapper (separate from `@/utils/intuitAPI`,
// the QBO REST client). It must be mocked here — not per-file — because the
// integration project runs with `pool: 'forks' + fileParallelism: false +
// isolate: false`, which means the module registry is shared across files.
// Once any earlier test transitively loads the real `@/utils/intuit` (via
// `auth.service.ts:20`), a per-file `vi.mock(...)` in a later file no longer
// applies. Tests configure per-test behavior via
// `vi.mocked(Intuit.getInstance).mockReturnValue(...)` in beforeEach.
//
// Why pin the mock on `globalThis`: this `setupFiles` is evaluated more than
// once per run when separate test files trigger fresh module-graph contexts
// (observed under pool:forks + isolate:false on this branch — see commit
// message). A naive `vi.mock('@/utils/intuit', () => ({ default: { getInstance:
// vi.fn() } }))` would produce a *different* `vi.fn()` per factory invocation:
// `tokenRefresh.ts` (transitively imported by webhook tests early in the run)
// would close over the first instance, while a later test file that imports
// `Intuit` directly would wire `vi.mocked(...)` against the second — and the
// per-test mockReturnValue would never be visible to the production call
// site. Stashing the singleton on `globalThis` (one process, since
// fileParallelism is false) makes every factory invocation hand back the
// same `getInstance` mock, so any test's beforeEach wiring is what the
// runtime sees.
const INTUIT_MOCK_GLOBAL_KEY = '__qbsync_intuit_mock_singleton__'
type IntuitMockSingleton = {
  default: { getInstance: ReturnType<typeof vi.fn> }
}
const globalRef = globalThis as unknown as Record<
  string,
  IntuitMockSingleton | undefined
>
if (!globalRef[INTUIT_MOCK_GLOBAL_KEY]) {
  globalRef[INTUIT_MOCK_GLOBAL_KEY] = {
    default: { getInstance: vi.fn() },
  }
}
vi.mock(
  '@/utils/intuit',
  () => globalRef[INTUIT_MOCK_GLOBAL_KEY] as IntuitMockSingleton,
)

vi.mock('@sentry/nextjs', () => ({
  withScope: vi.fn((cb: (scope: unknown) => void) =>
    cb({
      setTag: vi.fn(),
      setExtra: vi.fn(),
      addEventProcessor: vi.fn(),
    }),
  ),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  addBreadcrumb: vi.fn(),
  init: vi.fn(),
}))

// Webhook pre-claim sleeps would add ≥7s per test; we don't exercise race
// ordering at this layer.
vi.mock('@/utils/sleep', () => ({
  sleep: vi.fn().mockResolvedValue(undefined),
}))

// AB gate for the bank deposit rollout. The real allowlist is parsed from env
// at `@/config` module load, so it can't be varied per-test once loaded. We
// mock the gate here (setupFiles runs before any app module binds it) and drive
// it via a globalThis-pinned allowlist. Default `null` = feature on for all
// portals, matching the empty-env behavior so existing tests are unaffected.
// A test opts in by setting `abTestGate.allowlist`; reset it in afterEach.
const AB_GATE_GLOBAL_KEY = '__qbsync_ab_test_gate__'
type ABGate = { allowlist: string[] | null }
const abGateRef = globalThis as unknown as Record<string, ABGate | undefined>
abGateRef[AB_GATE_GLOBAL_KEY] ??= { allowlist: null }
vi.mock('@/utils/abTesting', () => ({
  isPortalInBankDepositABTest: (portalId: string) => {
    const gate = abGateRef[AB_GATE_GLOBAL_KEY]!
    return gate.allowlist === null || gate.allowlist.includes(portalId)
  },
}))

// Importing modules that pull `next/server` corrupts NTARH's AsyncLocalStorage.
// Shimming this entry point keeps the next/server import out of the graph.
vi.mock('@/app/api/core/utils/afterIfAvailable', () => ({
  afterIfAvailable: (callback: () => Promise<void>) => {
    void callback().catch((err) => {
      console.error('[afterIfAvailable mock] callback failed:', err)
    })
  },
}))
