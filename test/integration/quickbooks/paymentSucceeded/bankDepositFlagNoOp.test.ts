import { describe, it, expect } from 'vitest'
import { eq } from 'drizzle-orm'

import { db } from '@/db'
import { QBSyncLog } from '@/db/schema/qbSyncLogs'

import { paymentSucceededPayload } from '@test/fixtures/paymentSucceeded.webhook'
import { seedHealthyPortal, TEST_COPILOT_PAYMENT_ID } from '@test/helpers/seed'
import { setupPaymentSucceededTest } from '@test/helpers/paymentSucceededTestSetup'
import { postWebhook } from '@test/helpers/webhook'

describe('payment.succeeded with bankDepositFeeFlag on — no per-payment deposit', () => {
  const apis = setupPaymentSucceededTest()

  it('creates neither a deposit nor a purchase', async () => {
    // handlePaymentSucceeded returns immediately once bankDepositFeeFlag is
    // true (the deposit is deferred to payout.reconciliation_completed), so
    // no invoice sync, bank account ref, or QBO calls are ever reached here.
    await seedHealthyPortal({
      setting: { absorbedFeeFlag: true, bankDepositFeeFlag: true },
    })

    const res = await postWebhook(paymentSucceededPayload)
    expect(res.status).toBe(200)

    expect(apis.intuit.createDeposit).not.toHaveBeenCalled()
    expect(apis.intuit.createPurchase).not.toHaveBeenCalled()

    const logs = await db
      .select()
      .from(QBSyncLog)
      .where(eq(QBSyncLog.copilotId, TEST_COPILOT_PAYMENT_ID))
    expect(logs.filter((l) => l.status === 'success')).toHaveLength(0)
  })
})
