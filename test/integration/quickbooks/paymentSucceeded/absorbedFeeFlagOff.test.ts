import { describe, it, expect } from 'vitest'

import { db } from '@/db'
import { QBSyncLog } from '@/db/schema/qbSyncLogs'

import { paymentSucceededPayload } from '@test/fixtures/paymentSucceeded.webhook'
import { seedHealthyPortal, seedQBInvoiceSync } from '@test/helpers/seed'
import { setupPaymentSucceededTest } from '@test/helpers/paymentSucceededTestSetup'
import { postWebhook } from '@test/helpers/webhook'

describe('POST /api/quickbooks/webhook — payment.succeeded (absorbed-fee flag off)', () => {
  const apis = setupPaymentSucceededTest()

  it('skips processing when the portal opts out of recording absorbed fees', async () => {
    await seedHealthyPortal({ setting: { absorbedFeeFlag: false } })
    await seedQBInvoiceSync()

    const res = await postWebhook(paymentSucceededPayload)
    expect(res.status).toBe(200)

    expect(await db.select().from(QBSyncLog)).toHaveLength(0)
    expect(apis.copilot.getInvoice).not.toHaveBeenCalled()
    expect(apis.intuit.getAnAccount).not.toHaveBeenCalled()
    expect(apis.intuit.createPurchase).not.toHaveBeenCalled()
  })
})
