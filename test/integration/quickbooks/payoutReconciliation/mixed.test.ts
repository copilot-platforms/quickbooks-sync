import { describe, it, expect } from 'vitest'
import { and, eq } from 'drizzle-orm'

import { db } from '@/db'
import { QBSyncLog } from '@/db/schema/qbSyncLogs'
import { EntityType, EventType, LogStatus } from '@/app/api/core/types/log'

import { PAYOUT_MIXED_INTENT_CODE } from '@/constant/intuitErrorCode'
import { payoutPayload } from '@test/fixtures/payout.webhook'
import {
  seedHealthyPortal,
  seedPaidInvoiceForPayout,
  TEST_COPILOT_INVOICE_ID,
  TEST_BANK_ACCOUNT_REF,
} from '@test/helpers/seed'
import { setupPaymentSucceededTest } from '@test/helpers/paymentSucceededTestSetup'
import { postWebhook } from '@test/helpers/webhook'

describe('payout — invoices froze a mix of batched and non-batched', () => {
  const apis = setupPaymentSucceededTest()

  it('rejects the payout without booking a deposit and logs it FAILED (no retry)', async () => {
    await seedHealthyPortal({
      portal: { bankAccountRef: TEST_BANK_ACCOUNT_REF },
    })
    await seedPaidInvoiceForPayout({
      copilotInvoiceId: TEST_COPILOT_INVOICE_ID,
      invoiceNumber: 'INV-A',
      paymentId: 'qbpay_A',
      isBatchedDeposit: true,
    })
    await seedPaidInvoiceForPayout({
      copilotInvoiceId: 'inv-cop-0002',
      invoiceNumber: 'INV-B',
      paymentId: 'qbpay_B',
      isBatchedDeposit: false,
    })

    const res = await postWebhook(payoutPayload)
    expect(res.status).toBe(200)

    expect(apis.intuit.createDeposit).not.toHaveBeenCalled()

    const [payoutLog] = await db
      .select()
      .from(QBSyncLog)
      .where(
        and(
          eq(QBSyncLog.entityType, EntityType.PAYOUT),
          eq(QBSyncLog.eventType, EventType.SETTLED),
          eq(QBSyncLog.copilotId, 'po_test_1'),
        ),
      )
    expect(payoutLog.status).toBe(LogStatus.FAILED)
    expect(payoutLog.shouldRetry).toBe(false)
    expect(payoutLog.errorMessage).toContain('mixes batched and non-batched')
    // Routable sentinel so SyncErrorNotifier notifies IUs for manual reconciliation.
    expect(payoutLog.errorCode).toBe(PAYOUT_MIXED_INTENT_CODE)
    // No qbItemName: it would outrank copilotId in the notification's entity
    // reference, hiding which payout to reconcile.
    expect(payoutLog.qbItemName).toBeNull()
    // remark carries the affected invoice numbers so the IU notification can
    // name which invoices went unrecorded.
    expect(payoutLog.remark).toBe('INV-A, INV-B')
  })
})
