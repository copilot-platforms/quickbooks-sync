import { describe, it, expect } from 'vitest'
import { eq } from 'drizzle-orm'

import { db } from '@/db'
import { QBProductSync } from '@/db/schema/qbProductSync'
import { QBSyncLog } from '@/db/schema/qbSyncLogs'
import { EntityType, EventType, LogStatus } from '@/app/api/core/types/log'

import priceCreatedPayload from '@test/fixtures/priceCreated.webhook.json'
import { seedHealthyPortal, TEST_PORTAL_ID } from '@test/helpers/seed'
import { setupPriceCreatedTest } from '@test/helpers/priceCreatedTestSetup'
import { postWebhook } from '@test/helpers/webhook'

describe('POST /api/quickbooks/webhook — price.created (happy path)', () => {
  setupPriceCreatedTest()

  it('creates the QB item, writes qb_product_sync row, and logs SUCCESS', async () => {
    await seedHealthyPortal()

    const res = await postWebhook(priceCreatedPayload)
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ ok: true })

    // ---- Assert the product mapping was persisted ----
    const productSyncRows = await db
      .select()
      .from(QBProductSync)
      .where(eq(QBProductSync.priceId, priceCreatedPayload.data.id))

    expect(productSyncRows).toHaveLength(1)
    expect(productSyncRows[0]).toMatchObject({
      portalId: TEST_PORTAL_ID,
      productId: priceCreatedPayload.data.productId,
      priceId: priceCreatedPayload.data.id,
      qbItemId: '999',
      qbSyncToken: '0',
      // price is stored in cents as a decimal string
      unitPrice: '60000.00',
      copilotName: 'Test Product',
    })

    // ---- Assert a SUCCESS sync log was written ----
    const syncLogs = await db
      .select()
      .from(QBSyncLog)
      .where(eq(QBSyncLog.copilotPriceId, priceCreatedPayload.data.id))

    expect(syncLogs).toHaveLength(1)
    expect(syncLogs[0]).toMatchObject({
      portalId: TEST_PORTAL_ID,
      entityType: EntityType.PRODUCT,
      eventType: EventType.CREATED,
      status: LogStatus.SUCCESS,
      copilotId: priceCreatedPayload.data.productId,
      copilotPriceId: priceCreatedPayload.data.id,
      quickbooksId: '999',
    })
  })
})
