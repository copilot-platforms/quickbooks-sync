/**
 * Freeze-point coverage for InvoiceService#readBankDepositFeeFlag — the one
 * place invoice creation decides batched intent. A portal outside the AB
 * allowlist must freeze non-batched regardless of its stored setting, and must
 * not even read the setting. readBankDepositFeeFlag is private, reached via a
 * type cast (same approach as invoice.service.docNumber.test.ts).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@sentry/nextjs', () => ({
  withScope: vi.fn((cb: (scope: unknown) => void) =>
    cb({ setTag: vi.fn(), setExtra: vi.fn(), addEventProcessor: vi.fn() }),
  ),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  addBreadcrumb: vi.fn(),
  init: vi.fn(),
}))
vi.mock('@/utils/logger', () => ({
  default: { info: vi.fn(), error: vi.fn() },
}))
vi.mock('@/utils/copilotAPI', () => ({ CopilotAPI: vi.fn() }))
vi.mock('@/utils/intuitAPI', () => ({
  default: vi.fn(),
  IntuitAPIErrorMessage: '#IntuitAPIErrorMessage#',
}))
// BaseService imports `@/db`, which initialises postgres at module load.
vi.mock('@/db', () => ({ db: {}, client: {} }))
vi.mock('@/utils/sentry', () => ({
  addSyncBreadcrumb: vi.fn(),
  captureSyncError: vi.fn(),
}))
// SyncLogService is instantiated in the InvoiceService constructor.
vi.mock('@/app/api/quickbooks/syncLog/syncLog.service', () => ({
  SyncLogService: vi.fn(function () {
    return {}
  }),
}))

const { getOneByPortalId, isPortalInBankDepositABTest } = vi.hoisted(() => ({
  getOneByPortalId: vi.fn(),
  isPortalInBankDepositABTest: vi.fn(),
}))
vi.mock('@/app/api/quickbooks/setting/setting.service', () => ({
  SettingService: vi.fn(function () {
    return { getOneByPortalId }
  }),
}))
vi.mock('@/utils/abTesting', () => ({ isPortalInBankDepositABTest }))

import { InvoiceService } from '@/app/api/quickbooks/invoice/invoice.service'
import User from '@/app/api/core/models/User.model'

const stubUser = {
  workspaceId: 'test-portal-00000001',
  token: 'tkn',
  qbConnection: undefined,
} as unknown as User

type WithReadFlag = { readBankDepositFeeFlag: () => Promise<boolean> }
const newSvc = () => new InvoiceService(stubUser) as unknown as WithReadFlag

describe('InvoiceService#readBankDepositFeeFlag — AB freeze gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('freezes non-batched and skips the setting read for an excluded portal', async () => {
    isPortalInBankDepositABTest.mockReturnValue(false)
    getOneByPortalId.mockResolvedValue({ bankDepositFeeFlag: true })

    expect(await newSvc().readBankDepositFeeFlag()).toBe(false)
    expect(getOneByPortalId).not.toHaveBeenCalled()
  })

  it('honors the stored flag for an allowlisted portal', async () => {
    isPortalInBankDepositABTest.mockReturnValue(true)
    getOneByPortalId.mockResolvedValue({ bankDepositFeeFlag: true })

    expect(await newSvc().readBankDepositFeeFlag()).toBe(true)
  })

  it('defaults to false when an allowlisted portal has no setting row', async () => {
    isPortalInBankDepositABTest.mockReturnValue(true)
    getOneByPortalId.mockResolvedValue(undefined)

    expect(await newSvc().readBankDepositFeeFlag()).toBe(false)
  })
})
