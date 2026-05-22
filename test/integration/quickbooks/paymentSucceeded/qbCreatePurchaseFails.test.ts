import { describe, it, expect, vi } from 'vitest'
import { eq } from 'drizzle-orm'

import { db } from '@/db'
import { QBSyncLog } from '@/db/schema/qbSyncLogs'
import { EntityType, EventType, LogStatus } from '@/app/api/core/types/log'

import paymentSucceededPayload from '@test/fixtures/paymentSucceeded.webhook'
import {
  seedHealthyPortal,
  seedQBInvoiceSync,
  TEST_COPILOT_PAYMENT_ID,
} from '@test/helpers/seed'
import { createMockIntuitAPI } from '@test/helpers/mocks'
import { setupPaymentSucceededTest } from '@test/helpers/paymentSucceededTestSetup'
import { postWebhook } from '@test/helpers/webhook'

describe('POST /api/quickbooks/webhook — payment.succeeded (QuickBooks rejects the expense)', () => {
  const apis = setupPaymentSucceededTest(() => ({
    intuit: createMockIntuitAPI({
      createPurchase: vi
        .fn()
        .mockRejectedValue(new Error('QuickBooks is on fire')),
    }),
  }))

  it('marks the sync log as FAILED and does not attempt to delete a purchase that was never created', async () => {
    await seedHealthyPortal({ setting: { absorbedFeeFlag: true } })
    await seedQBInvoiceSync()

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
      feeAmount: '2500.00',
    })
    expect(logs[0].errorMessage).toContain('QuickBooks is on fire')

    expect(apis.intuit.createPurchase).toHaveBeenCalledTimes(1)
    expect(apis.intuit.deletePurchase).not.toHaveBeenCalled()
  })
})
