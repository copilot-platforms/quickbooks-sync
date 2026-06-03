import { beforeEach, afterEach, vi } from 'vitest'
import { truncateAllTestTables } from '@test/helpers/testDb'
import {
  installMockApis,
  type MockCopilotAPI,
  type MockIntuitAPI,
} from '@test/helpers/mocks'

type InstallOpts = Parameters<typeof installMockApis>[0]

export interface ProductCreatedTestHandle {
  copilot: MockCopilotAPI
  intuit: MockIntuitAPI
}

/**
 * beforeEach (truncate + installMockApis) / afterEach (clearAllMocks) for
 * product.created tests. Returns a handle with fresh copilot/intuit mocks per
 * test. optsFactory runs per test so overrides get fresh vi.fn()s.
 */
export function setupProductCreatedTest(
  optsFactory?: () => InstallOpts,
): ProductCreatedTestHandle {
  const handle = {} as ProductCreatedTestHandle

  beforeEach(async () => {
    await truncateAllTestTables()
    const { copilot, intuit } = installMockApis(optsFactory?.())
    handle.copilot = copilot
    handle.intuit = intuit
  })

  afterEach(() => {
    // clearAllMocks (not restoreAllMocks): keep the module-level factories installed.
    vi.clearAllMocks()
  })

  return handle
}
