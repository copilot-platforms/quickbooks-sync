import { beforeEach, afterEach, vi } from 'vitest'
import { truncateAllTestTables } from '@test/helpers/testDb'
import {
  installMockApis,
  type MockCopilotAPI,
  type MockIntuitAPI,
} from '@test/helpers/mocks'

type InstallOpts = Parameters<typeof installMockApis>[0]

export interface InvoicePaidTestHandle {
  copilot: MockCopilotAPI
  intuit: MockIntuitAPI
}

/**
 * beforeEach (truncate + installMockApis) and afterEach (clearAllMocks) hooks
 * for invoice.paid tests. Mirrors `setupPaymentSucceededTest`; `optsFactory`
 * runs once per test so override `vi.fn()`s are freshly instantiated.
 */
export function setupInvoicePaidTest(
  optsFactory?: () => InstallOpts,
): InvoicePaidTestHandle {
  const handle = {} as InvoicePaidTestHandle

  beforeEach(async () => {
    await truncateAllTestTables()
    const { copilot, intuit } = installMockApis(optsFactory?.())
    handle.copilot = copilot
    handle.intuit = intuit
  })

  afterEach(() => {
    // clearAllMocks (not restoreAllMocks) keeps the module-level mock factories installed.
    vi.clearAllMocks()
  })

  return handle
}
