import { describe, it, expect, vi } from 'vitest'
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
import { createMockIntuitAPI } from '@test/helpers/mocks'
import { setupPaymentSucceededTest } from '@test/helpers/paymentSucceededTestSetup'
import { postWebhook } from '@test/helpers/webhook'

describe('payout — configured bank account no longer exists in QuickBooks', () => {
  const apis = setupPaymentSucceededTest(() => ({
    intuit: createMockIntuitAPI({
      // The bank ref query comes back empty (deleted in QBO); the expense
      // ref lookup must still resolve normally.
      getAnAccount: vi
        .fn()
        .mockImplementation(async (_name?: string, id?: string) => {
          if (id === TEST_BANK_ACCOUNT_REF) return undefined
          return {
            Id: id,
            Name: 'Sales of Product Income',
            SyncToken: '0',
            Active: true,
          }
        }),
    }),
  }))

  it('aborts the deposit and logs a failed payout/settled entry asking to reselect a bank account', async () => {
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

    expect(apis.intuit.createDeposit).not.toHaveBeenCalled()

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
      // Not permanent: it works again once the user picks a bank account.
      shouldRetry: true,
    })
    // Pins the abort to restoreAccountRef's Bank-type throw specifically —
    // a deleted bank account is never auto-restored/created.
    expect(logs[0].errorMessage).toContain('reselect a bank account')
  })
})
