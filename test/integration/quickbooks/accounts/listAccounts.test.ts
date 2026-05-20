import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { testApiHandler } from 'next-test-api-route-handler'

import * as appHandler from '@/app/api/quickbooks/accounts/route'
import { truncateAllTestTables } from '@test/helpers/testDb'
import { createMockIntuitAPI, installMockApis } from '@test/helpers/mocks'
import {
  seedHealthyPortal,
  TEST_ASSET_ACCOUNT_REF,
  TEST_EXPENSE_ACCOUNT_REF,
  TEST_INCOME_ACCOUNT_REF,
  TEST_WEBHOOK_TOKEN,
} from '@test/helpers/seed'

describe('GET /api/quickbooks/accounts', () => {
  beforeEach(async () => {
    await truncateAllTestTables()
    installMockApis({
      intuit: createMockIntuitAPI({
        getAccountsForProductMapping: vi.fn().mockResolvedValue({
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
        }),
      }),
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it("returns options grouped by bucket and the portal's currently-selected refs", async () => {
    await seedHealthyPortal()

    await testApiHandler({
      appHandler,
      url: `/api/quickbooks/accounts?token=${TEST_WEBHOOK_TOKEN}`,
      test: async ({ fetch }) => {
        const res = await fetch({ method: 'GET' })
        expect(res.status).toBe(200)
        const body = await res.json()
        expect(body.options.income).toEqual([
          { id: '100', name: 'Sales' },
          { id: '200', name: 'Service Income' },
        ])
        expect(body.options.expense).toEqual([
          { id: '102', name: 'Cost of Goods' },
        ])
        expect(body.options.asset).toEqual([
          { id: '101', name: 'Inventory Asset' },
        ])
        expect(body.selected).toEqual({
          incomeAccountRef: TEST_INCOME_ACCOUNT_REF,
          expenseAccountRef: TEST_EXPENSE_ACCOUNT_REF,
          assetAccountRef: TEST_ASSET_ACCOUNT_REF,
        })
      },
    })
  })

  it('returns 401 without a token', async () => {
    await testApiHandler({
      appHandler,
      url: `/api/quickbooks/accounts`,
      test: async ({ fetch }) => {
        const res = await fetch({ method: 'GET' })
        expect(res.status).toBe(401)
      },
    })
  })
})
