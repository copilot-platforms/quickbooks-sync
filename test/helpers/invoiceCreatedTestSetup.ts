import { beforeEach, afterEach, vi } from 'vitest'
import { truncateAllTestTables } from '@test/helpers/testDb'
import {
  installMockApis,
  type MockAssemblyAPI,
  type MockIntuitAPI,
} from '@test/helpers/mocks'

type InstallOpts = Parameters<typeof installMockApis>[0]

export interface InvoiceCreatedTestHandle {
  copilot: MockAssemblyAPI
  intuit: MockIntuitAPI
}

/**
 * Registers the standard `beforeEach` (truncate + installMockApis) and
 * `afterEach` (clearAllMocks) hooks used by every invoice.created integration
 * test. Returns a live handle whose `copilot` / `intuit` properties are
 * replaced with fresh mock instances before each test.
 *
 * Mirrors `setupProductCreatedTest`. The `optsFactory` is invoked once per test
 * so callers can supply overrides whose underlying `vi.fn()`s are freshly
 * instantiated.
 */
export function setupInvoiceCreatedTest(
  optsFactory?: () => InstallOpts,
): InvoiceCreatedTestHandle {
  const handle = {} as InvoiceCreatedTestHandle

  beforeEach(async () => {
    await truncateAllTestTables()
    const { copilot, intuit } = installMockApis(optsFactory?.())
    handle.copilot = copilot
    handle.intuit = intuit
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  return handle
}
