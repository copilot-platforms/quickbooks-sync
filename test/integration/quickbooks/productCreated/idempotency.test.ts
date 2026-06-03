import { describe, it, expect } from 'vitest'

import { db } from '@/db'
import { QBProductSync } from '@/db/schema/qbProductSync'
import { QBSyncLog } from '@/db/schema/qbSyncLogs'

import productCreatedPayload from '@test/fixtures/productCreated.webhook'
import { seedHealthyPortal, seedProductSync } from '@test/helpers/seed'
import { setupProductCreatedTest } from '@test/helpers/productCreatedTestSetup'
import { postWebhook } from '@test/helpers/webhook'

// Re-sending product.created for an already-mapped product must not duplicate it.
describe('POST /api/quickbooks/webhook — product.created (idempotency)', () => {
  const apis = setupProductCreatedTest()

  it('skips QB calls and writes no new rows when the product is already mapped', async () => {
    await seedHealthyPortal()

    // Pre-existing mapping for THIS product.
    await seedProductSync({
      productId: productCreatedPayload.data.id,
      qbItemId: 'pre-existing-qb-item',
    })

    const res = await postWebhook(productCreatedPayload)
    expect(res.status).toBe(200)

    // Duplicate check runs before any QB call.
    expect(apis.intuit.getAnItem).not.toHaveBeenCalled()
    expect(apis.intuit.createItem).not.toHaveBeenCalled()

    // Still just the seeded row, unchanged.
    const productRows = await db.select().from(QBProductSync)
    expect(productRows).toHaveLength(1)
    expect(productRows[0].qbItemId).toBe('pre-existing-qb-item')

    // And no sync log row (early return skips logging)
    const logRows = await db.select().from(QBSyncLog)
    expect(logRows).toHaveLength(0)
  })
})
