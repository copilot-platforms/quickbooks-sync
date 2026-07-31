/**
 * Unit tests for `IntuitAPI._getDepositsByTxnDate` — the idempotency lookup
 * behind the payout resync path. Coverage focus: pagination correctness.
 * A portal can have >1 page of deposits on the same TxnDate; missing a
 * match past position 1000 would let a resync create a duplicate deposit
 * (QBO has no deleteDeposit, so this is a real double-book vector).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@sentry/nextjs', () => ({
  withScope: vi.fn(),
  captureMessage: vi.fn(),
  captureException: vi.fn(),
}))

vi.mock('@/utils/logger', () => ({
  default: { info: vi.fn(), error: vi.fn() },
}))

vi.mock('@/helper/fetch.helper', () => ({
  getFetcher: vi.fn(),
  postFetcher: vi.fn(),
}))

import IntuitAPI, { IntuitAPITokensType } from '@/utils/intuitAPI'

const baseTokens: IntuitAPITokensType = {
  accessToken: 'access',
  refreshToken: 'refresh',
  intuitRealmId: 'realm-1',
  incomeAccountRef: 'income',
  expenseAccountRef: 'expense',
  assetAccountRef: 'asset',
  serviceItemRef: 'service',
  clientFeeRef: 'client-fee',
  bankAccountRef: 'bank',
}

// Builds a deposit row in the shape QBO returns inside `QueryResponse.Deposit`.
const row = (id: string, privateNote?: string) => ({
  Id: id,
  ...(privateNote ? { PrivateNote: privateNote } : {}),
  TxnDate: '2026-07-29',
})

// `customQuery` is a public field on IntuitAPI (`this.wrapWithRetry(this._customQuery)`).
// Replace it on the instance after construction, matching the pattern in
// intuitAPI.test.ts / intuitAPI.accounts.test.ts.
function makeApi(pages: Array<unknown>) {
  const api = new IntuitAPI(baseTokens)
  const customQuery = vi.fn()
  for (const page of pages) {
    customQuery.mockResolvedValueOnce(page)
  }
  customQuery.mockImplementation(() => {
    throw new Error('customQuery called more times than test configured')
  })
  ;(api as unknown as { customQuery: unknown }).customQuery = customQuery
  return { api, customQuery }
}

describe('IntuitAPI#getDepositsByTxnDate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns all rows from a single short page without a second call', async () => {
    const { api, customQuery } = makeApi([
      { Deposit: [row('dep-1', 'Stripe payout po_1'), row('dep-2')] },
    ])

    const result = await api.getDepositsByTxnDate('2026-07-29')

    expect(result).toHaveLength(2)
    expect(customQuery).toHaveBeenCalledTimes(1)
  })

  it('paginates across a full page and a short page, advancing STARTPOSITION 1 -> 1001', async () => {
    const page1 = {
      Deposit: Array.from({ length: 1000 }, (_, i) => row(`p1-${i}`)),
    }
    const page2 = {
      Deposit: [row('p2-0', 'Stripe payout po_target'), row('p2-1')],
    }
    const { api, customQuery } = makeApi([page1, page2])

    const result = await api.getDepositsByTxnDate('2026-07-29')

    expect(customQuery).toHaveBeenCalledTimes(2)
    const firstQuery = customQuery.mock.calls[0][0] as string
    const secondQuery = customQuery.mock.calls[1][0] as string
    expect(firstQuery).toContain('STARTPOSITION 1 ')
    expect(secondQuery).toContain('STARTPOSITION 1001 ')

    expect(result).toHaveLength(1002)
    expect(
      result.some((d) => d.PrivateNote === 'Stripe payout po_target'),
    ).toBe(true)
  })
})
