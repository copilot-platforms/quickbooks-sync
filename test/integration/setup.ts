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
 */

vi.mock('@/utils/copilotAPI', () => ({
  CopilotAPI: vi.fn(),
}))

vi.mock('@/utils/intuitAPI', () => ({
  default: vi.fn(),
  // Named export used by src/utils/error.ts to detect Intuit-sourced APIErrors
  // when unwrapping error messages in the webhook catch block.
  IntuitAPIErrorMessage: '#IntuitAPIErrorMessage#',
}))

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
