import { describe, it, expect } from 'vitest'

import { db } from '@/db'
import { QBSyncLog } from '@/db/schema/qbSyncLogs'

import { paymentSucceededPayload } from '@test/fixtures/paymentSucceeded.webhook'
import { seedHealthyPortal, seedQBInvoiceSync } from '@test/helpers/seed'
import { setupPaymentSucceededTest } from '@test/helpers/paymentSucceededTestSetup'
import { postWebhook } from '@test/helpers/webhook'

describe('POST /api/quickbooks/webhook — payment.succeeded (no platform-paid fee)', () => {
  const apis = setupPaymentSucceededTest()

  it.each([
    {
      label: 'fee paid entirely by the client',
      feeAmount: { paidByPlatform: 0, paidByClient: 2500 },
    },
    {
      label: 'no fee data on the payment',
      feeAmount: null,
    },
  ])('skips processing when there is $label', async ({ feeAmount }) => {
    // The handler short-circuits before the absorbedFeeFlag check, so the
    // flag value shouldn't matter — but seeding the healthy default keeps
    // the test representative of a normal portal.
    await seedHealthyPortal({ setting: { absorbedFeeFlag: true } })
    await seedQBInvoiceSync()

    const payload = {
      ...paymentSucceededPayload,
      data: { ...paymentSucceededPayload.data, feeAmount },
    }

    const res = await postWebhook(payload)
    expect(res.status).toBe(200)

    expect(await db.select().from(QBSyncLog)).toHaveLength(0)
    expect(apis.copilot.getInvoice).not.toHaveBeenCalled()
    expect(apis.intuit.createPurchase).not.toHaveBeenCalled()
  })
})
