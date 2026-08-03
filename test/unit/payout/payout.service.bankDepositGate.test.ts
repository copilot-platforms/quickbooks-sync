/**
 * AB-gate coverage for PayoutService#reconcile — the deposit-creating step,
 * shared by the payout webhook and the resync cron. An excluded portal must
 * short-circuit to { depositId: null } before any token check or QBO call.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { QBPayoutSyncSelectSchemaType } from '@/db/schema/qbPayoutSync'
import type { IntuitAPITokensType } from '@/utils/intuitAPI'

vi.mock('@sentry/nextjs', () => ({
  withScope: vi.fn(),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  addBreadcrumb: vi.fn(),
  init: vi.fn(),
}))
// BaseService imports `@/db`, which initialises postgres at module load.
vi.mock('@/db', () => ({ db: {}, client: {} }))
vi.mock('@/utils/copilotAPI', () => ({ CopilotAPI: vi.fn() }))
vi.mock('@/utils/intuitAPI', () => ({ default: vi.fn() }))
vi.mock('@/app/api/quickbooks/syncLog/syncLog.service', () => ({
  SyncLogService: vi.fn(function () {
    return {}
  }),
}))

const { validateAccessToken, isPortalInBankDepositABTest } = vi.hoisted(() => ({
  validateAccessToken: vi.fn(),
  isPortalInBankDepositABTest: vi.fn(),
}))
vi.mock('@/utils/auth', () => ({ validateAccessToken }))
vi.mock('@/utils/abTesting', () => ({ isPortalInBankDepositABTest }))

import { PayoutService } from '@/app/api/quickbooks/payout/payout.service'
import User from '@/app/api/core/models/User.model'

const stubUser = { workspaceId: 'test-portal-00000001' } as unknown as User
const stubRow = {
  payoutId: 'po_123',
} as unknown as QBPayoutSyncSelectSchemaType
const stubTokens = {} as IntuitAPITokensType

describe('PayoutService#reconcile — AB gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('short-circuits to no deposit for an excluded portal without checking the token', async () => {
    isPortalInBankDepositABTest.mockReturnValue(false)

    const result = await new PayoutService(stubUser).reconcile(
      stubRow,
      stubTokens,
      { runIdempotencyCheck: true },
    )

    expect(result).toEqual({ depositId: null })
    expect(validateAccessToken).not.toHaveBeenCalled()
  })

  it('proceeds past the gate for an allowlisted portal', async () => {
    isPortalInBankDepositABTest.mockReturnValue(true)
    // Force a stop right after the gate so we assert only that it advanced.
    validateAccessToken.mockImplementation(() => {
      throw new Error('advanced past gate')
    })

    await expect(
      new PayoutService(stubUser).reconcile(stubRow, stubTokens, {
        runIdempotencyCheck: true,
      }),
    ).rejects.toThrow('advanced past gate')
    expect(validateAccessToken).toHaveBeenCalledTimes(1)
  })
})
