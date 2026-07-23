import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { testApiHandler } from 'next-test-api-route-handler'

import * as appHandler from '@/app/api/quickbooks/setting/bank-account/route'
import { truncateAllTestTables } from '@test/helpers/testDb'
import { createMockIntuitAPI, installMockApis } from '@test/helpers/mocks'
import { seedHealthyPortal, TEST_WEBHOOK_TOKEN } from '@test/helpers/seed'

describe('GET /api/quickbooks/setting/bank-account', () => {
  beforeEach(async () => {
    await truncateAllTestTables()
    installMockApis({
      intuit: createMockIntuitAPI({
        // Mirrors QBO's real response shape: the controller's SELECT lists
        // QB_ACCOUNT_COLUMNS (Id, Name, SyncToken, Active, AccountType), and
        // QBO only returns the columns asked for.
        customQuery: vi.fn().mockResolvedValue({
          Account: [
            {
              Id: '103',
              Name: 'Checking',
              SyncToken: '0',
              Active: true,
              AccountType: 'Bank',
            },
          ],
        }),
      }),
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('returns active bank accounts with Id and Name present', async () => {
    await seedHealthyPortal()

    await testApiHandler({
      appHandler,
      url: `/api/quickbooks/setting/bank-account?token=${TEST_WEBHOOK_TOKEN}`,
      test: async ({ fetch }) => {
        const res = await fetch({ method: 'GET' })
        expect(res.status).toBe(200)
        const body = await res.json()
        expect(body.accounts).toHaveLength(1)
        // Full row also carries SyncToken/Active/AccountType (see mock above);
        // the UI only needs Id/Name, so check those two are present.
        expect(body.accounts[0]).toMatchObject({
          Id: '103',
          Name: 'Checking',
        })
      },
    })
  })

  it('returns 401 without a token', async () => {
    await testApiHandler({
      appHandler,
      url: `/api/quickbooks/setting/bank-account`,
      test: async ({ fetch }) => {
        const res = await fetch({ method: 'GET' })
        expect(res.status).toBe(401)
      },
    })
  })
})
