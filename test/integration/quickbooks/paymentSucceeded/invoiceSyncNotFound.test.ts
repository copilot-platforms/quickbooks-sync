import { describe, it, expect } from 'vitest'
import { eq } from 'drizzle-orm'

import { db } from '@/db'
import { QBSyncLog } from '@/db/schema/qbSyncLogs'
import { EntityType, EventType, LogStatus } from '@/app/api/core/types/log'

import { paymentSucceededPayload } from '@test/fixtures/paymentSucceeded.webhook'
import { seedHealthyPortal, TEST_COPILOT_PAYMENT_ID } from '@test/helpers/seed'
import { setupPaymentSucceededTest } from '@test/helpers/paymentSucceededTestSetup'
import { postWebhook } from '@test/helpers/webhook'

describe('POST /api/quickbooks/webhook — payment.succeeded (no local invoice mapping)', () => {
  const apis = setupPaymentSucceededTest()

  it('marks the sync log as FAILED when the invoice has not been mirrored to QuickBooks yet', async () => {
    // Healthy portal but NO seedQBInvoiceSync — local lookup must miss.
    await seedHealthyPortal({ setting: { absorbedFeeFlag: true } })

    const res = await postWebhook(paymentSucceededPayload)
    expect(res.status).toBe(200)

    const logs = await db
      .select()
      .from(QBSyncLog)
      .where(eq(QBSyncLog.copilotId, TEST_COPILOT_PAYMENT_ID))
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatchObject({
      entityType: EntityType.PAYMENT,
      eventType: EventType.SUCCEEDED,
      status: LogStatus.FAILED,
    })
    expect(logs[0].errorMessage).toContain(
      'No invoice found in invoice sync table',
    )

    expect(apis.intuit.createPurchase).not.toHaveBeenCalled()
    expect(apis.intuit.deletePurchase).not.toHaveBeenCalled()
  })
})
