import { describe, it, expect } from 'vitest'
import { and, eq } from 'drizzle-orm'

import { db } from '@/db'
import { QBSyncLog } from '@/db/schema/qbSyncLogs'
import { EntityType, EventType, LogStatus } from '@/app/api/core/types/log'

import {
  payoutReconciliationPayload,
  TEST_PAYOUT_ID,
  TEST_COPILOT_INVOICE_ID_A,
  TEST_COPILOT_INVOICE_ID_B,
} from '@test/fixtures/payoutReconciliation.webhook'
import {
  seedHealthyPortal,
  seedPaidInvoiceForPayout,
  TEST_BANK_ACCOUNT_REF,
} from '@test/helpers/seed'
import { setupPayoutReconciliationTest } from '@test/helpers/payoutReconciliationTestSetup'
import { postWebhook } from '@test/helpers/webhook'

describe('POST /api/quickbooks/webhook — payout.reconciliation_completed (all invoices batched)', () => {
  const apis = setupPayoutReconciliationTest()

  it('creates one batched bank deposit and logs the payout as SUCCESS', async () => {
    await seedHealthyPortal({
      portal: { bankAccountRef: TEST_BANK_ACCOUNT_REF },
    })
    await seedPaidInvoiceForPayout({
      copilotInvoiceId: TEST_COPILOT_INVOICE_ID_A,
      invoiceNumber: 'INV-A',
      paymentId: 'qb-pay-A',
      isBatchedDeposit: true,
    })
    await seedPaidInvoiceForPayout({
      copilotInvoiceId: TEST_COPILOT_INVOICE_ID_B,
      invoiceNumber: 'INV-B',
      paymentId: 'qb-pay-B',
      isBatchedDeposit: true,
    })

    const res = await postWebhook(payoutReconciliationPayload)
    expect(res.status).toBe(200)

    // Both payments swept into a single deposit landing in the bank account.
    expect(apis.intuit.createDeposit).toHaveBeenCalledTimes(1)
    const [depositPayload] = apis.intuit.createDeposit.mock.calls[0]
    expect(depositPayload.DepositToAccountRef).toEqual({
      value: TEST_BANK_ACCOUNT_REF,
    })

    const [payoutLog] = await db
      .select()
      .from(QBSyncLog)
      .where(
        and(
          eq(QBSyncLog.entityType, EntityType.PAYOUT),
          eq(QBSyncLog.eventType, EventType.SETTLED),
          eq(QBSyncLog.copilotId, TEST_PAYOUT_ID),
        ),
      )
    expect(payoutLog.status).toBe(LogStatus.SUCCESS)
    expect(payoutLog.quickbooksId).toBe('qb-deposit-1')
  })
})
