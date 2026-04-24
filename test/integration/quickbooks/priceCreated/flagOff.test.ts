import { describe, it, expect } from 'vitest'

import { db } from '@/db'
import { QBProductSync } from '@/db/schema/qbProductSync'
import { QBSyncLog } from '@/db/schema/qbSyncLogs'

import priceCreatedPayload from '@test/fixtures/priceCreated.webhook.json'
import { seedHealthyPortal } from '@test/helpers/seed'
import { setupPriceCreatedTest } from '@test/helpers/priceCreatedTestSetup'
import { postWebhook } from '@test/helpers/webhook'

describe('POST /api/quickbooks/webhook — price.created (createNewProductFlag=false)', () => {
  const apis = setupPriceCreatedTest()

  it('returns 200 without syncing, makes no product API calls, writes no rows', async () => {
    await seedHealthyPortal({ setting: { createNewProductFlag: false } })

    const res = await postWebhook(priceCreatedPayload)
    expect(res.status).toBe(200)

    // The flag gate sits BEFORE the switch in WebhookService#handleWebhookEvent,
    // so no product-side API calls fire.
    expect(apis.copilot.getProduct).not.toHaveBeenCalled()
    expect(apis.intuit.getAnItem).not.toHaveBeenCalled()
    expect(apis.intuit.createItem).not.toHaveBeenCalled()

    // And no mapping / sync log rows should exist.
    const productRows = await db.select().from(QBProductSync)
    expect(productRows).toHaveLength(0)

    const logRows = await db.select().from(QBSyncLog)
    expect(logRows).toHaveLength(0)
  })
})
