import { describe, it, expect } from 'vitest'

import { db } from '@/db'
import { QBProductSync } from '@/db/schema/qbProductSync'
import { QBSyncLog } from '@/db/schema/qbSyncLogs'

import priceCreatedPayload from '@test/fixtures/priceCreated.webhook.json'
import { seedHealthyPortal, seedProductSync } from '@test/helpers/seed'
import { setupPriceCreatedTest } from '@test/helpers/priceCreatedTestSetup'
import { postWebhook } from '@test/helpers/webhook'

/**
 * Idempotency: re-sending the same price.created webhook must not create a
 * duplicate mapping. ProductService#webhookPriceCreated short-circuits when it
 * finds an existing qb_product_sync row with the same productId AND priceId.
 */
describe('POST /api/quickbooks/webhook — price.created (idempotency)', () => {
  const apis = setupPriceCreatedTest()

  it('skips QB calls and writes no new rows when the price is already mapped', async () => {
    await seedHealthyPortal()

    // Pre-existing mapping for THIS exact productId + priceId.
    // Direct insert intentionally bypasses ProductService.createQBProduct so
    // the test doesn't exercise a second request path; if the duplicate-check
    // logic ever starts depending on extra fields (description, copilotName),
    // this seed may need to match those shape requirements.
    await seedProductSync({
      productId: priceCreatedPayload.data.productId,
      priceId: priceCreatedPayload.data.id,
      qbItemId: 'pre-existing-qb-item',
    })

    const res = await postWebhook(priceCreatedPayload)
    expect(res.status).toBe(200)

    // Duplicate check runs BEFORE copilot.getProduct and any QB call, so
    // none of these external calls should fire at all.
    expect(apis.copilot.getProduct).not.toHaveBeenCalled()
    expect(apis.intuit.getAnItem).not.toHaveBeenCalled()
    expect(apis.intuit.createItem).not.toHaveBeenCalled()

    // Still only one mapping row — the one we seeded — with its original qbItemId
    const productRows = await db.select().from(QBProductSync)
    expect(productRows).toHaveLength(1)
    expect(productRows[0].qbItemId).toBe('pre-existing-qb-item')

    // And no sync log row (early return skips logging)
    const logRows = await db.select().from(QBSyncLog)
    expect(logRows).toHaveLength(0)
  })
})
