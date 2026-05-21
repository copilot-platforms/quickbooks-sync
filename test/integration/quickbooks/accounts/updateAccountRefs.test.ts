import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { testApiHandler } from 'next-test-api-route-handler'
import { eq } from 'drizzle-orm'

import * as appHandler from '@/app/api/quickbooks/accounts/route'
import { db } from '@/db'
import { QBPortalConnection } from '@/db/schema/qbPortalConnections'
import { truncateAllTestTables } from '@test/helpers/testDb'
import { installMockApis } from '@test/helpers/mocks'
import {
  seedHealthyPortal,
  TEST_PORTAL_ID,
  TEST_INCOME_ACCOUNT_REF,
  TEST_EXPENSE_ACCOUNT_REF,
  TEST_ASSET_ACCOUNT_REF,
  TEST_WEBHOOK_TOKEN,
} from '@test/helpers/seed'

describe('PATCH /api/quickbooks/accounts', () => {
  beforeEach(async () => {
    await truncateAllTestTables()
    installMockApis()
  })
  afterEach(() => vi.clearAllMocks())

  it('updates only the income ref when only income is provided', async () => {
    await seedHealthyPortal()

    await testApiHandler({
      appHandler,
      url: `/api/quickbooks/accounts?token=${TEST_WEBHOOK_TOKEN}`,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'PATCH',
          body: JSON.stringify({ incomeAccountRef: '500' }),
          headers: { 'content-type': 'application/json' },
        })
        expect(res.status).toBe(200)
        const body = await res.json()
        expect(body.portalConnection.incomeAccountRef).toBe('500')
        expect(body.portalConnection.accessToken).toBeUndefined()
        expect(body.portalConnection.refreshToken).toBeUndefined()
      },
    })

    const rows = await db
      .select()
      .from(QBPortalConnection)
      .where(eq(QBPortalConnection.portalId, TEST_PORTAL_ID))
    expect(rows[0].incomeAccountRef).toBe('500')
    expect(rows[0].expenseAccountRef).toBe(TEST_EXPENSE_ACCOUNT_REF)
    expect(rows[0].assetAccountRef).toBe(TEST_ASSET_ACCOUNT_REF)
  })

  it('rejects empty body with 422', async () => {
    await seedHealthyPortal()
    await testApiHandler({
      appHandler,
      url: `/api/quickbooks/accounts?token=${TEST_WEBHOOK_TOKEN}`,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'PATCH',
          body: JSON.stringify({}),
          headers: { 'content-type': 'application/json' },
        })
        expect(res.status).toBe(422)
      },
    })
  })

  it('updates all three refs when all are provided', async () => {
    await seedHealthyPortal()

    await testApiHandler({
      appHandler,
      url: `/api/quickbooks/accounts?token=${TEST_WEBHOOK_TOKEN}`,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'PATCH',
          body: JSON.stringify({
            incomeAccountRef: '700',
            expenseAccountRef: '701',
            assetAccountRef: '702',
          }),
          headers: { 'content-type': 'application/json' },
        })
        expect(res.status).toBe(200)
        const body = await res.json()
        expect(body.portalConnection.incomeAccountRef).toBe('700')
        expect(body.portalConnection.expenseAccountRef).toBe('701')
        expect(body.portalConnection.assetAccountRef).toBe('702')
        expect(body.portalConnection.accessToken).toBeUndefined()
        expect(body.portalConnection.refreshToken).toBeUndefined()
        expect(body.portalConnection.tokenType).toBeUndefined()
      },
    })

    const rows = await db
      .select()
      .from(QBPortalConnection)
      .where(eq(QBPortalConnection.portalId, TEST_PORTAL_ID))
    expect(rows[0].incomeAccountRef).toBe('700')
    expect(rows[0].expenseAccountRef).toBe('701')
    expect(rows[0].assetAccountRef).toBe('702')
  })

  it("cannot modify another portal's row (tenant isolation)", async () => {
    // CopilotAPI mock always decrypts to TEST_PORTAL_ID, so this verifies the
    // WHERE-clause scope works — not that a foreign token would be rejected.
    await seedHealthyPortal()
    const OTHER = 'other-portal-99999999'
    await seedHealthyPortal({
      portal: { portalId: OTHER, intuitRealmId: 'other-realm' },
      setting: { portalId: OTHER },
    })

    await testApiHandler({
      appHandler,
      url: `/api/quickbooks/accounts?token=${TEST_WEBHOOK_TOKEN}`,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'PATCH',
          body: JSON.stringify({ incomeAccountRef: '700' }),
          headers: { 'content-type': 'application/json' },
        })
        expect(res.status).toBe(200)
      },
    })

    const a = await db
      .select()
      .from(QBPortalConnection)
      .where(eq(QBPortalConnection.portalId, TEST_PORTAL_ID))
    expect(a[0].incomeAccountRef).toBe('700')

    const b = await db
      .select()
      .from(QBPortalConnection)
      .where(eq(QBPortalConnection.portalId, OTHER))
    expect(b[0].incomeAccountRef).toBe(TEST_INCOME_ACCOUNT_REF)
  })

  it('returns 401 without a token', async () => {
    await testApiHandler({
      appHandler,
      url: `/api/quickbooks/accounts`,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'PATCH',
          body: JSON.stringify({ incomeAccountRef: '1' }),
          headers: { 'content-type': 'application/json' },
        })
        expect(res.status).toBe(401)
      },
    })
  })
})
