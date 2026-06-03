import { describe, it, expect } from 'vitest'
import { eq } from 'drizzle-orm'

import { db } from '@/db'
import { QBProductSync } from '@/db/schema/qbProductSync'
import { QBSyncLog } from '@/db/schema/qbSyncLogs'
import { EntityType, EventType, LogStatus } from '@/app/api/core/types/log'

import productCreatedPayload from '@test/fixtures/productCreated.webhook'
import { seedHealthyPortal, TEST_PORTAL_ID } from '@test/helpers/seed'
import { setupProductCreatedTest } from '@test/helpers/productCreatedTestSetup'
import { postWebhook } from '@test/helpers/webhook'

describe('POST /api/quickbooks/webhook — product.created (happy path)', () => {
  setupProductCreatedTest()

  it('creates the QB item, writes qb_product_sync row, and logs SUCCESS', async () => {
    await seedHealthyPortal()

    const res = await postWebhook(productCreatedPayload)
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ ok: true })

    // ---- Assert the product mapping was persisted (one row per product) ----
    const productSyncRows = await db
      .select()
      .from(QBProductSync)
      .where(eq(QBProductSync.productId, productCreatedPayload.data.id))

    expect(productSyncRows).toHaveLength(1)
    expect(productSyncRows[0]).toMatchObject({
      portalId: TEST_PORTAL_ID,
      productId: productCreatedPayload.data.id,
      qbItemId: '999',
      qbSyncToken: '0',
      copilotName: 'Test Product',
    })

    // ---- Assert a SUCCESS sync log was written ----
    const syncLogs = await db
      .select()
      .from(QBSyncLog)
      .where(eq(QBSyncLog.copilotId, productCreatedPayload.data.id))

    expect(syncLogs).toHaveLength(1)
    expect(syncLogs[0]).toMatchObject({
      portalId: TEST_PORTAL_ID,
      entityType: EntityType.PRODUCT,
      eventType: EventType.CREATED,
      status: LogStatus.SUCCESS,
      copilotId: productCreatedPayload.data.id,
      quickbooksId: '999',
    })
  })
})
