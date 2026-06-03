import { describe, it, expect } from 'vitest'
import { eq } from 'drizzle-orm'

import { db } from '@/db'
import { QBProductSync } from '@/db/schema/qbProductSync'

import productCreatedPayload from '@test/fixtures/productCreated.webhook'
import { seedHealthyPortal, seedProductSync } from '@test/helpers/seed'
import { setupProductCreatedTest } from '@test/helpers/productCreatedTestSetup'
import { postWebhook } from '@test/helpers/webhook'

// A soft-deleted row must not block re-creation (getAllByProductId filters deletedAt).
describe('POST /api/quickbooks/webhook — product.created (soft-deleted prior mapping)', () => {
  const apis = setupProductCreatedTest()

  it('creates the item when the only existing row is soft-deleted', async () => {
    await seedHealthyPortal()
    await seedProductSync({
      productId: productCreatedPayload.data.id,
      qbItemId: 'qb-item-old',
      qbSyncToken: '0',
      deletedAt: new Date('2026-01-01T00:00:00.000Z'),
    })

    const res = await postWebhook(productCreatedPayload)
    expect(res.status).toBe(200)

    expect(apis.intuit.createItem).toHaveBeenCalledTimes(1)

    const liveRows = await db
      .select()
      .from(QBProductSync)
      .where(eq(QBProductSync.productId, productCreatedPayload.data.id))
    // one soft-deleted + one fresh live row
    expect(liveRows.filter((r) => r.deletedAt === null)).toHaveLength(1)
  })
})
