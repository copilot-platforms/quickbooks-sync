import { beforeEach, afterEach, vi } from 'vitest'
import { truncateAllTestTables } from '@test/helpers/testDb'
import {
  installMockApis,
  type MockCopilotAPI,
  type MockIntuitAPI,
} from '@test/helpers/mocks'

type InstallOpts = Parameters<typeof installMockApis>[0]

export interface PaymentSucceededTestHandle {
  copilot: MockCopilotAPI
  intuit: MockIntuitAPI
}

/**
 * Registers the standard `beforeEach` (truncate + installMockApis) and
 * `afterEach` (clearAllMocks) hooks used by every payment.succeeded
 * integration test. Mirrors `setupInvoiceCreatedTest` /
 * `setupPriceCreatedTest`. The `optsFactory` is invoked once per test so
 * callers can supply overrides whose underlying `vi.fn()`s are freshly
 * instantiated.
 */
export function setupPaymentSucceededTest(
  optsFactory?: () => InstallOpts,
): PaymentSucceededTestHandle {
  const handle = {} as PaymentSucceededTestHandle

  beforeEach(async () => {
    await truncateAllTestTables()
    const { copilot, intuit } = installMockApis(optsFactory?.())
    handle.copilot = copilot
    handle.intuit = intuit
  })

  afterEach(() => {
    // clearAllMocks (not restoreAllMocks) — the module-level mock factories in
    // test/integration/setup.ts must stay installed across tests; we only want
    // to reset call counts and implementations set in beforeEach.
    vi.clearAllMocks()
  })

  return handle
}
