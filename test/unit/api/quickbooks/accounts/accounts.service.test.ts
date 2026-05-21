/**
 * AccountService.listAccountsForProductMapping loads the portal connection
 * (for selected refs + IntuitAPI tokens), delegates to IntuitAPI for the
 * three pick-lists, and strips SyncToken/Active from the response.
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

const intuit = {
  getAccountsForProductMapping: vi.fn(),
}
// Mock impl uses `function` (not arrow) so `new IntuitAPI(...)` is callable.
vi.mock('@/utils/intuitAPI', () => ({
  default: vi.fn().mockImplementation(function (this: unknown) {
    return intuit
  }),
  IntuitAPIErrorMessage: '#IntuitAPIErrorMessage#',
}))

const tokens = {
  accessToken: 'access',
  refreshToken: 'refresh',
  intuitRealmId: 'realm-1',
  incomeAccountRef: '100',
  expenseAccountRef: '102',
  assetAccountRef: '101',
  serviceItemRef: null,
  clientFeeRef: null,
}

const getPortalTokens = vi.fn(async (_portalId: string) => tokens)
vi.mock('@/db/service/token.service', () => ({
  getPortalTokens: (portalId: string) => getPortalTokens(portalId),
}))

import { AccountService } from '@/app/api/quickbooks/accounts/accounts.service'
import User from '@/app/api/core/models/User.model'

const fakeUser = new User('test-token', {
  workspaceId: 'portal-1',
  internalUserId: 'user-1',
})

describe('AccountService.listAccountsForProductMapping', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getPortalTokens.mockResolvedValue(tokens)
    intuit.getAccountsForProductMapping.mockResolvedValue({
      income: [
        {
          Id: '100',
          Name: 'Sales',
          SyncToken: '0',
          Active: true,
          AccountType: 'Income',
        },
        {
          Id: '200',
          Name: 'Service Income',
          SyncToken: '0',
          Active: true,
          AccountType: 'Income',
        },
      ],
      expense: [
        {
          Id: '102',
          Name: 'Cost of Goods',
          SyncToken: '0',
          Active: true,
          AccountType: 'Expense',
        },
      ],
      asset: [
        {
          Id: '101',
          Name: 'Inventory Asset',
          SyncToken: '0',
          Active: true,
          AccountType: 'OtherCurrentAsset',
        },
      ],
    })
  })

  it('returns options grouped by bucket with only id+name, plus selected refs', async () => {
    const svc = new AccountService(fakeUser)
    const out = await svc.listAccountsForProductMapping()

    expect(out.options.income).toEqual([
      { id: '100', name: 'Sales' },
      { id: '200', name: 'Service Income' },
    ])
    expect(out.options.expense).toEqual([{ id: '102', name: 'Cost of Goods' }])
    expect(out.options.asset).toEqual([{ id: '101', name: 'Inventory Asset' }])
    expect(out.selected).toEqual({
      incomeAccountRef: '100',
      expenseAccountRef: '102',
      assetAccountRef: '101',
    })
  })
})
