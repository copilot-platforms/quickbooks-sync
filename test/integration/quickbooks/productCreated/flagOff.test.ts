import { describe, it, expect } from 'vitest'

import { db } from '@/db'
import { QBProductSync } from '@/db/schema/qbProductSync'
import { QBSyncLog } from '@/db/schema/qbSyncLogs'

import productCreatedPayload from '@test/fixtures/productCreated.webhook'
import { seedHealthyPortal } from '@test/helpers/seed'
import { setupProductCreatedTest } from '@test/helpers/productCreatedTestSetup'
import { postWebhook } from '@test/helpers/webhook'

describe('POST /api/quickbooks/webhook — product.created (createNewProductFlag=false)', () => {
  const apis = setupProductCreatedTest()

  it('returns 200 without syncing, makes no product API calls, writes no rows', async () => {
    await seedHealthyPortal({ setting: { createNewProductFlag: false } })

    const res = await postWebhook(productCreatedPayload)
    expect(res.status).toBe(200)

    // Flag gate runs before the switch, so no product API calls fire.
    expect(apis.intuit.getAnItem).not.toHaveBeenCalled()
    expect(apis.intuit.createItem).not.toHaveBeenCalled()

    // And no mapping / sync log rows should exist.
    const productRows = await db.select().from(QBProductSync)
    expect(productRows).toHaveLength(0)

    const logRows = await db.select().from(QBSyncLog)
    expect(logRows).toHaveLength(0)
  })
})
