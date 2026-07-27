import { describe, it, expect } from 'vitest'
import { eq } from 'drizzle-orm'

import { db } from '@/db'
import { QBSyncLog } from '@/db/schema/qbSyncLogs'
import { EntityType, EventType, LogStatus } from '@/app/api/core/types/log'

import { payoutPayload } from '@test/fixtures/payout.webhook'
import {
  seedHealthyPortal,
  seedPaidInvoiceForPayout,
  TEST_PORTAL_ID,
  TEST_COPILOT_INVOICE_ID,
  TEST_BANK_ACCOUNT_REF,
  TEST_EXPENSE_ACCOUNT_REF,
} from '@test/helpers/seed'
import { setupPaymentSucceededTest } from '@test/helpers/paymentSucceededTestSetup'
import { postWebhook } from '@test/helpers/webhook'

describe('payout — reported net amount does not match the line items', () => {
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
      isBatchedDeposit: true,
    })

    const payloadWithWrongNetAmount = {
      ...payoutPayload,
      data: {
        ...payoutPayload.data,
        payout: { ...payoutPayload.data.payout, netAmount: 99999 },
      },
    }

    const res = await postWebhook(payloadWithWrongNetAmount)
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
    // Pins the abort to the sum-mismatch guard specifically — not the
    // unresolved-line guard, the refund guard, or the bankAccountRef guard.
    expect(logs[0].errorMessage).toContain(
      'deposit total 34425 != payout net 99999',
    )
  })
})
