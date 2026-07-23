import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { testApiHandler } from 'next-test-api-route-handler'
import { eq } from 'drizzle-orm'

import * as appHandler from '@/app/api/quickbooks/setting/route'
import { db } from '@/db'
import { QBSetting } from '@/db/schema/qbSettings'
import { QBPortalConnection } from '@/db/schema/qbPortalConnections'
import { truncateAllTestTables } from '@test/helpers/testDb'
import { installMockApis } from '@test/helpers/mocks'
import {
  seedHealthyPortal,
  TEST_PORTAL_ID,
  TEST_WEBHOOK_TOKEN,
} from '@test/helpers/seed'

describe('GET/POST /api/quickbooks/setting?type=invoice', () => {
  beforeEach(async () => {
    await truncateAllTestTables()
    installMockApis()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('persists bankDepositFeeFlag on qb_settings and bankAccountRef on qb_portal_connections', async () => {
    await seedHealthyPortal()

    await testApiHandler({
      appHandler,
      url: `/api/quickbooks/setting?type=invoice&token=${TEST_WEBHOOK_TOKEN}`,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          body: JSON.stringify({
            type: 'invoice',
            absorbedFeeFlag: false,
            useCompanyNameFlag: false,
            bankDepositFeeFlag: true,
            bankAccountRef: '103',
          }),
          headers: { 'content-type': 'application/json' },
        })
        expect(res.status).toBe(201)
      },
    })

    const [setting] = await db
      .select()
      .from(QBSetting)
      .where(eq(QBSetting.portalId, TEST_PORTAL_ID))
    expect(setting.bankDepositFeeFlag).toBe(true)

    const [portalConnection] = await db
      .select()
      .from(QBPortalConnection)
      .where(eq(QBPortalConnection.portalId, TEST_PORTAL_ID))
    expect(portalConnection.bankAccountRef).toBe('103')
  })

  it('rejects bankDepositFeeFlag true without a bankAccountRef with 422', async () => {
    await seedHealthyPortal()

    await testApiHandler({
      appHandler,
      url: `/api/quickbooks/setting?type=invoice&token=${TEST_WEBHOOK_TOKEN}`,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          body: JSON.stringify({
            type: 'invoice',
            absorbedFeeFlag: false,
            useCompanyNameFlag: false,
            bankDepositFeeFlag: true,
          }),
          headers: { 'content-type': 'application/json' },
        })
        expect(res.status).toBe(422)
      },
    })

    // Rejected request must not have written a bank account ref.
    const [portalConnection] = await db
      .select()
      .from(QBPortalConnection)
      .where(eq(QBPortalConnection.portalId, TEST_PORTAL_ID))
    expect(portalConnection.bankAccountRef).toBeNull()
  })

  it('returns bankAccountRef alongside the invoice setting', async () => {
    await seedHealthyPortal({
      portal: { bankAccountRef: '103' },
    })

    await testApiHandler({
      appHandler,
      url: `/api/quickbooks/setting?type=invoice&token=${TEST_WEBHOOK_TOKEN}`,
      test: async ({ fetch }) => {
        const res = await fetch({ method: 'GET' })
        expect(res.status).toBe(200)
        const body = await res.json()
        expect(body.bankAccountRef).toBe('103')
        expect(body.setting).toMatchObject({
          absorbedFeeFlag: false,
          useCompanyNameFlag: false,
        })
      },
    })
  })
})
