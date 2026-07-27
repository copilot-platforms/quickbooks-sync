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

describe('payout — the total fee across line items is negative', () => {
  const apis = setupPaymentSucceededTest()

  it('aborts the deposit and logs a failed payout/settled entry', async () => {
    // Seed the bank + expense account refs so the missing-bankAccountRef guard
    // can't be what trips instead of the guard under test.
    await seedHealthyPortal({
      portal: {
        bankAccountRef: TEST_BANK_ACCOUNT_REF,
        expenseAccountRef: TEST_EXPENSE_ACCOUNT_REF,
      },
      setting: { absorbedFeeFlag: true, bankDepositFeeFlag: true },
    })
    // Both invoices resolve, so the unresolved-line guard can't trip either.
    await db.insert(QBSyncLog).values([
      {
        portalId: TEST_PORTAL_ID,
        copilotId: TEST_COPILOT_INVOICE_ID,
        entityType: EntityType.INVOICE,
        eventType: EventType.PAID,
        status: LogStatus.SUCCESS,
        quickbooksId: 'qbpay_A',
      },
      {
        portalId: TEST_PORTAL_ID,
        copilotId: 'inv-cop-0002',
        entityType: EntityType.INVOICE,
        eventType: EventType.PAID,
        status: LogStatus.SUCCESS,
        quickbooksId: 'qbpay_B',
      },
    ])

    // Positive gross on every line (so the refund guard passes), but the
    // aggregate fee is negative: 375 + (-1000) = -625. netAmount is set to the
    // internally consistent gross - fee (35000 - (-625) = 35625) so it is the
    // negative-fee guard — not a sum mismatch — that aborts.
    const payloadWithNegativeFee = {
      ...payoutPayload,
      data: {
        ...payoutPayload.data,
        payout: { ...payoutPayload.data.payout, netAmount: 35625 },
        lineItems: [
          {
            copilotInvoiceId: TEST_COPILOT_INVOICE_ID,
            grossAmount: 20000,
            feeAmount: 375,
          },
          {
            copilotInvoiceId: 'inv-cop-0002',
            grossAmount: 15000,
            feeAmount: -1000,
          },
        ],
      },
    }

    const res = await postWebhook(payloadWithNegativeFee)
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
    // Pins the abort to the negative-fee guard specifically — not the refund,
    // unresolved-line, sum-mismatch, or bankAccountRef guards.
    expect(logs[0].errorMessage).toContain('negative aggregate fee (-625)')
  })
})
