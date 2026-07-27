import { describe, it, expect } from 'vitest'

import { db } from '@/db'
import { QBSyncLog } from '@/db/schema/qbSyncLogs'

import { paymentSucceededPayload } from '@test/fixtures/paymentSucceeded.webhook'
import { seedHealthyPortal, seedQBInvoiceSync } from '@test/helpers/seed'
import { setupPaymentSucceededTest } from '@test/helpers/paymentSucceededTestSetup'
import { postWebhook } from '@test/helpers/webhook'

describe('POST /api/quickbooks/webhook — payment.succeeded (frozen batched-deposit intent)', () => {
  const apis = setupPaymentSucceededTest()

  it('defers with zero rows when the invoice froze batched intent, even though the live flag is now off', async () => {
    await seedHealthyPortal({
      setting: { absorbedFeeFlag: true, bankDepositFeeFlag: false },
    })
    await seedQBInvoiceSync({ isBatchedDeposit: true })

    const res = await postWebhook(paymentSucceededPayload)
    expect(res.status).toBe(200)

    expect(apis.intuit.createPurchase).not.toHaveBeenCalled()
    expect(await db.select().from(QBSyncLog)).toHaveLength(0)
  })

  it('books the absorbed-fee expense when the invoice froze non-batched intent, even though the live flag is now on', async () => {
    await seedHealthyPortal({
      setting: { absorbedFeeFlag: true, bankDepositFeeFlag: true },
    })
    await seedQBInvoiceSync({ isBatchedDeposit: false })

    const res = await postWebhook(paymentSucceededPayload)
    expect(res.status).toBe(200)

    expect(apis.intuit.createPurchase).toHaveBeenCalledTimes(1)
  })
})
