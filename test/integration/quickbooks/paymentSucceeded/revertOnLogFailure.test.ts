import { describe, it, expect, vi, afterEach } from 'vitest'
import { eq } from 'drizzle-orm'

import { db } from '@/db'
import { QBSyncLog } from '@/db/schema/qbSyncLogs'
import { EntityType, EventType, LogStatus } from '@/app/api/core/types/log'
import { SyncLogService } from '@/app/api/quickbooks/syncLog/syncLog.service'

import { paymentSucceededPayload } from '@test/fixtures/paymentSucceeded.webhook'
import {
  seedHealthyPortal,
  seedQBInvoiceSync,
  TEST_COPILOT_PAYMENT_ID,
  TEST_QB_PURCHASE_ID,
} from '@test/helpers/seed'
import { setupPaymentSucceededTest } from '@test/helpers/paymentSucceededTestSetup'
import { postWebhook } from '@test/helpers/webhook'

describe('POST /api/quickbooks/webhook — payment.succeeded (inner log write fails after QB purchase created)', () => {
  const apis = setupPaymentSucceededTest()

  // Restore spies so they don't leak onto the shared prototype under isolate:false.
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('deletes the created purchase and writes a FAILED log when the success-log write fails', async () => {
    await seedHealthyPortal({ setting: { absorbedFeeFlag: true } })
    await seedQBInvoiceSync()

    // Fail only the SUCCESS log write; mockImplementationOnce is one-shot, so
    // the outer catch's FAILED log falls through to the real impl.
    vi.spyOn(
      SyncLogService.prototype,
      'updateOrCreateQBSyncLog',
    ).mockImplementationOnce(async () => {
      throw new Error('Sync log write failed')
    })

    const res = await postWebhook(paymentSucceededPayload)
    expect(res.status).toBe(200)

    // Revert was invoked with the just-created purchase id + sync token.
    expect(apis.intuit.createPurchase).toHaveBeenCalledTimes(1)
    expect(apis.intuit.deletePurchase).toHaveBeenCalledTimes(1)
    expect(apis.intuit.deletePurchase).toHaveBeenCalledWith({
      Id: TEST_QB_PURCHASE_ID,
      SyncToken: '0',
    })

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
    expect(logs[0].errorMessage).toContain('Sync log write failed')
  })
})
