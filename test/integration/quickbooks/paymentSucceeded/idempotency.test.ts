import { describe, it, expect } from 'vitest'

import { db } from '@/db'
import { QBSyncLog } from '@/db/schema/qbSyncLogs'
import { EntityType, EventType, LogStatus } from '@/app/api/core/types/log'

import { paymentSucceededPayload } from '@test/fixtures/paymentSucceeded.webhook'
import {
  seedHealthyPortal,
  seedQBInvoiceSync,
  TEST_PORTAL_ID,
  TEST_INVOICE_NUMBER,
  TEST_COPILOT_PAYMENT_ID,
  TEST_QB_PURCHASE_ID,
} from '@test/helpers/seed'
import { setupPaymentSucceededTest } from '@test/helpers/paymentSucceededTestSetup'
import { postWebhook } from '@test/helpers/webhook'

describe('POST /api/quickbooks/webhook — payment.succeeded (same webhook delivered twice)', () => {
  const apis = setupPaymentSucceededTest()

  it('processes the payment only once when a sync log for it already exists', async () => {
    await seedHealthyPortal({ setting: { absorbedFeeFlag: true } })
    await seedQBInvoiceSync()

    // Simulate a prior successful delivery that already claimed and processed
    // this payment. Inline insert mirrors the pattern in invoiceCreated/idempotency.test.ts.
    await db.insert(QBSyncLog).values({
      portalId: TEST_PORTAL_ID,
      entityType: EntityType.PAYMENT,
      eventType: EventType.SUCCEEDED,
      status: LogStatus.SUCCESS,
      copilotId: TEST_COPILOT_PAYMENT_ID,
      invoiceNumber: TEST_INVOICE_NUMBER,
      quickbooksId: TEST_QB_PURCHASE_ID,
      feeAmount: '2500.00',
      qbItemName: 'Assembly Fees',
      remark: 'Absorbed fees',
    })

    const res = await postWebhook(paymentSucceededPayload)
    expect(res.status).toBe(200)

    // Seeded log row stays exactly as it was; the second delivery did not
    // overwrite it or insert a new row.
    const logs = await db.select().from(QBSyncLog)
    expect(logs).toHaveLength(1)
    expect(logs[0].status).toBe(LogStatus.SUCCESS)

    expect(apis.copilot.getInvoice).not.toHaveBeenCalled()
    expect(apis.intuit.createPurchase).not.toHaveBeenCalled()
    expect(apis.intuit.deletePurchase).not.toHaveBeenCalled()
  })
})
