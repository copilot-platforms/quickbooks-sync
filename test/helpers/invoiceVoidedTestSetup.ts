import { beforeEach, afterEach, vi } from 'vitest'
import { truncateAllTestTables } from '@test/helpers/testDb'
import {
  installMockApis,
  type MockAssemblyAPI,
  type MockIntuitAPI,
} from '@test/helpers/mocks'

type InstallOpts = Parameters<typeof installMockApis>[0]

export interface InvoiceVoidedTestHandle {
  copilot: MockAssemblyAPI
  intuit: MockIntuitAPI
}

/**
 * beforeEach (truncate + installMockApis) and afterEach (clearAllMocks) hooks
 * for invoice.voided tests. Mirrors `setupInvoicePaidTest`; `optsFactory`
 * runs once per test so override `vi.fn()`s are freshly instantiated.
 */
export function setupInvoiceVoidedTest(
  optsFactory?: () => InstallOpts,
): InvoiceVoidedTestHandle {
  const handle = {} as InvoiceVoidedTestHandle

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
