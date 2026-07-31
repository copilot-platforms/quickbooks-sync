import { describe, it, expect, vi } from 'vitest'
import { eq } from 'drizzle-orm'

import { db } from '@/db'
import { QBSyncLog } from '@/db/schema/qbSyncLogs'
import { EntityType, EventType, LogStatus } from '@/app/api/core/types/log'
import { payoutPayload } from '@test/fixtures/payout.webhook'
import {
  seedHealthyPortal,
  seedPaidInvoiceForPayout,
  TEST_COPILOT_INVOICE_ID,
  TEST_BANK_ACCOUNT_REF,
  TEST_EXPENSE_ACCOUNT_REF,
} from '@test/helpers/seed'
import { setupPaymentSucceededTest } from '@test/helpers/paymentSucceededTestSetup'
import { createMockIntuitAPI } from '@test/helpers/mocks'
import { postWebhook } from '@test/helpers/webhook'

describe('payout reconciliation — transient failure', () => {
  // Registers module mocks; not read directly — this test asserts on
  // qb_sync_logs / qb_payout_sync instead of QBO call args.
  setupPaymentSucceededTest(() => ({
    intuit: createMockIntuitAPI({
      createDeposit: vi
        .fn()
        .mockRejectedValue(new Error('QuickBooks timed out')),
    }),
  }))

  it('marks a QBO write failure retryable and keeps the payout context', async () => {
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

    const res = await postWebhook(payoutPayload)
    expect(res.status).toBe(200)

    const logs = await db
      .select()
      .from(QBSyncLog)
      .where(eq(QBSyncLog.copilotId, 'po_test_1'))
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatchObject({
      entityType: EntityType.PAYOUT,
      eventType: EventType.SETTLED,
      status: LogStatus.FAILED,
      shouldRetry: true,
    })
    expect(logs[0].errorMessage).toContain('QuickBooks timed out')

    const payoutRow = await db.query.QBPayoutSync.findFirst()
    expect(payoutRow?.payoutId).toBe('po_test_1')
    expect(payoutRow?.qbDepositId).toBeNull()
  })
})
