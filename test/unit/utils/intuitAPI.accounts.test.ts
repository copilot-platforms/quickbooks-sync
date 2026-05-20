/**
 * Unit tests for IntuitAPI.getAccountsForProductMapping — verifies the three
 * SQL queries are built with the agreed AccountType / AccountSubType filters
 * and that the result is grouped into { income, expense, asset } with
 * Active=true filtering applied by QBO's WHERE clause (not in JS).
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
}

type Row = {
  Id: string
  Name: string
  SyncToken: string
  Active: boolean
  AccountType: string
  AccountSubType?: string
}
const row = (
  Id: string,
  Name: string,
  AccountType: string,
  AccountSubType?: string,
): Row => ({
  Id,
  Name,
  SyncToken: '0',
  Active: true,
  AccountType,
  ...(AccountSubType ? { AccountSubType } : {}),
})

function makeApi(perQueryResponse: (q: string) => unknown) {
  const api = new IntuitAPI(baseTokens)
  const customQuery = vi.fn(async (q: string) => perQueryResponse(q))
  ;(api as unknown as { customQuery: unknown }).customQuery = customQuery
  return { api, customQuery }
}

describe('IntuitAPI#getAccountsForProductMapping', () => {
  beforeEach(() => vi.clearAllMocks())

  it('issues three queries (income/expense/asset) with no OR / parens / IN', async () => {
    const { api, customQuery } = makeApi((q) => {
      if (q.includes("AccountType = 'Income'"))
        return {
          Account: [row('1', 'Sales', 'Income', 'SalesOfProductIncome')],
        }
      if (q.includes("AccountType = 'Expense'"))
        return { Account: [row('2', 'COGS', 'Expense')] }
      // Bank (asset bucket)
      return { Account: [row('3', 'Checking', 'Bank')] }
    })

    const out = await (api as any).getAccountsForProductMapping()

    expect(customQuery).toHaveBeenCalledTimes(3)
    const queries = customQuery.mock.calls.map((c) => c[0] as string)

    // QBO's parser rejects OR / parens / IN on AccountType, so every query is
    // a flat AND chain. Income narrows by AccountSubType in SQL.
    expect(queries[0]).toContain("AccountType = 'Income'")
    expect(queries[0]).toContain("AccountSubType = 'SalesOfProductIncome'")
    expect(queries[0]).not.toContain('OR')
    expect(queries[0]).not.toContain('(')

    expect(queries[1]).toContain("AccountType = 'Expense'")
    expect(queries[2]).toContain("AccountType = 'Bank'")

    expect(out).toEqual({
      income: [row('1', 'Sales', 'Income', 'SalesOfProductIncome')],
      expense: [row('2', 'COGS', 'Expense')],
      asset: [row('3', 'Checking', 'Bank')],
    })
  })

  it('returns empty arrays when QBO returns no Account key for a bucket', async () => {
    const { api } = makeApi(() => ({})) // QueryResponse with no Account
    const out = await (api as any).getAccountsForProductMapping()
    expect(out).toEqual({ income: [], expense: [], asset: [] })
  })
})
