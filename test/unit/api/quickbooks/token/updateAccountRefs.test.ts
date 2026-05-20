/**
 * TokenService.updateAccountRefs — validates each provided ref against QBO
 * (must exist, be active, and have the matching AccountType) before writing
 * to qb_portal_connections. Tenant scope is enforced by the caller via the
 * portal-id WHERE in updateQBPortalConnection.
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
  getAnAccount: vi.fn(),
}
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

import { TokenService } from '@/app/api/quickbooks/token/token.service'
import APIError from '@/app/api/core/exceptions/api'
import User from '@/app/api/core/models/User.model'

const fakeUser = new User('test-token', {
  workspaceId: 'portal-1',
  internalUserId: 'user-1',
})

function makeService() {
  const svc = new TokenService(fakeUser)
  // Replace the inherited update method with a spy so we can assert payload
  // shape without touching Postgres.
  ;(svc as any).updateQBPortalConnection = vi.fn(async () => ({}))
  return svc
}

describe('TokenService.updateAccountRefs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getPortalTokens.mockResolvedValue(tokens)
  })

  it('writes only the provided refs after validating their AccountType', async () => {
    intuit.getAnAccount.mockImplementation(async (_name: any, id: string) => {
      if (id === '300')
        return {
          Id: '300',
          Name: 'New Sales',
          SyncToken: '0',
          Active: true,
          AccountType: 'Income',
        }
      throw new Error(`unexpected id ${id}`)
    })

    const svc = makeService()
    await svc.updateAccountRefs({ incomeAccountRef: '300' })

    expect(intuit.getAnAccount).toHaveBeenCalledTimes(1)
    expect(getPortalTokens).toHaveBeenCalledWith('portal-1')
    expect((svc as any).updateQBPortalConnection).toHaveBeenCalledTimes(1)
    const [payload, where] = (svc as any).updateQBPortalConnection.mock.calls[0]
    expect(payload).toEqual({ incomeAccountRef: '300' })
    // The WHERE clause is a Drizzle SQL fragment. Inspect its queryChunks for
    // a column reference whose name is portal_id (tenant scoping).
    const chunks = (where as { queryChunks?: unknown[] }).queryChunks ?? []
    const referencesPortalId = chunks.some(
      (c) => (c as { name?: string })?.name === 'portal_id',
    )
    expect(referencesPortalId).toBe(true)
  })

  it('throws 400 when an income ref points at a non-Income account', async () => {
    intuit.getAnAccount.mockResolvedValue({
      Id: '400',
      Name: 'Bank',
      SyncToken: '0',
      Active: true,
      AccountType: 'Bank',
    })
    const svc = makeService()
    await expect(
      svc.updateAccountRefs({ incomeAccountRef: '400' }),
    ).rejects.toBeInstanceOf(APIError)
    expect((svc as any).updateQBPortalConnection).not.toHaveBeenCalled()
  })

  it('throws 400 when an expense ref points at the wrong AccountType', async () => {
    intuit.getAnAccount.mockResolvedValue({
      Id: '500',
      Name: 'Sales',
      SyncToken: '0',
      Active: true,
      AccountType: 'Income',
    })
    const svc = makeService()
    await expect(
      svc.updateAccountRefs({ expenseAccountRef: '500' }),
    ).rejects.toBeInstanceOf(APIError)
    expect((svc as any).updateQBPortalConnection).not.toHaveBeenCalled()
  })

  it('throws 400 when an asset ref is not in the asset AccountType set', async () => {
    intuit.getAnAccount.mockResolvedValue({
      Id: '600',
      Name: 'COGS',
      SyncToken: '0',
      Active: true,
      AccountType: 'Expense',
    })
    const svc = makeService()
    await expect(
      svc.updateAccountRefs({ assetAccountRef: '600' }),
    ).rejects.toBeInstanceOf(APIError)
    expect((svc as any).updateQBPortalConnection).not.toHaveBeenCalled()
  })

  it('throws 400 when QBO has no such account (getAnAccount returns null)', async () => {
    intuit.getAnAccount.mockResolvedValue(null)
    const svc = makeService()
    await expect(
      svc.updateAccountRefs({ incomeAccountRef: 'does-not-exist' }),
    ).rejects.toBeInstanceOf(APIError)
    expect((svc as any).updateQBPortalConnection).not.toHaveBeenCalled()
  })

  it('validates and writes all three when all are provided', async () => {
    intuit.getAnAccount.mockImplementation(async (_n: any, id: string) => {
      const map: Record<string, string> = {
        '300': 'Income',
        '301': 'Expense',
        '302': 'Bank',
      }
      return {
        Id: id,
        Name: `n-${id}`,
        SyncToken: '0',
        Active: true,
        AccountType: map[id],
      }
    })
    const svc = makeService()
    await svc.updateAccountRefs({
      incomeAccountRef: '300',
      expenseAccountRef: '301',
      assetAccountRef: '302',
    })
    expect(intuit.getAnAccount).toHaveBeenCalledTimes(3)
    const [payload] = (svc as any).updateQBPortalConnection.mock.calls[0]
    expect(payload).toEqual({
      incomeAccountRef: '300',
      expenseAccountRef: '301',
      assetAccountRef: '302',
    })
  })
})
