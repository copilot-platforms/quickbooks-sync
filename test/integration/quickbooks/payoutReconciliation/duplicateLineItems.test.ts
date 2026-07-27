import { describe, it, expect } from 'vitest'
import { eq } from 'drizzle-orm'

import { db } from '@/db'
import { QBSyncLog } from '@/db/schema/qbSyncLogs'
import { EntityType, EventType, LogStatus } from '@/app/api/core/types/log'

import { payoutPayload } from '@test/fixtures/payout.webhook'
import {
  seedHealthyPortal,
  TEST_PORTAL_ID,
  TEST_COPILOT_INVOICE_ID,
  TEST_BANK_ACCOUNT_REF,
  TEST_EXPENSE_ACCOUNT_REF,
} from '@test/helpers/seed'
import { setupPaymentSucceededTest } from '@test/helpers/paymentSucceededTestSetup'
import { postWebhook } from '@test/helpers/webhook'

describe('payout — two line items share the same invoice', () => {
  const apis = setupPaymentSucceededTest()

  it('aborts the deposit and logs a failed payout/settled entry', async () => {
    // Seed the bank + expense account refs so the handler's missing-
    // bankAccountRef guard can't be what trips instead of the guard under test.
    await seedHealthyPortal({
      portal: {
        bankAccountRef: TEST_BANK_ACCOUNT_REF,
        expenseAccountRef: TEST_EXPENSE_ACCOUNT_REF,
      },
      setting: { absorbedFeeFlag: true, bankDepositFeeFlag: true },
    })
    await db.insert(QBSyncLog).values({
      portalId: TEST_PORTAL_ID,
      copilotId: TEST_COPILOT_INVOICE_ID,
      entityType: EntityType.INVOICE,
      eventType: EventType.PAID,
      status: LogStatus.SUCCESS,
      quickbooksId: 'qbpay_A',
    })

    // Both line items reference the same invoice. gross (20000 + 375) - fee
    // (375 + 50) = 19950, so netAmount is set to 19950 to keep the sum-mismatch
    // guard from being what trips instead of the duplicate-line guard under test.
    const payloadWithDuplicateInvoice = {
      ...payoutPayload,
      data: {
        ...payoutPayload.data,
        payout: { ...payoutPayload.data.payout, netAmount: 19950 },
        lineItems: [
          {
            copilotInvoiceId: TEST_COPILOT_INVOICE_ID,
            grossAmount: 20000,
            feeAmount: 375,
          },
          {
            copilotInvoiceId: TEST_COPILOT_INVOICE_ID,
            grossAmount: 375,
            feeAmount: 50,
          },
        ],
      },
    }

    const res = await postWebhook(payloadWithDuplicateInvoice)
    expect(res.status).toBe(200)

    expect(apis.intuit.createDeposit).not.toHaveBeenCalled()
    // Guard trips before any QBO round-trip, so account verification never runs.
    expect(apis.intuit.getAnAccount).not.toHaveBeenCalled()

    const logs = await db
      .select()
      .from(QBSyncLog)
      .where(eq(QBSyncLog.copilotId, 'po_test_1'))
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatchObject({
      portalId: TEST_PORTAL_ID,
      entityType: EntityType.PAYOUT,
      eventType: EventType.SETTLED,
      status: LogStatus.FAILED,
      // Payout FAILED rows are terminal by design — never retryable.
      shouldRetry: false,
    })
    // Pins the abort to the duplicate-line guard specifically — not the
    // unresolved-line guard, the sum-mismatch guard, or the bankAccountRef guard.
    expect(logs[0].errorMessage).toContain('duplicate invoice line items')
  })
})
