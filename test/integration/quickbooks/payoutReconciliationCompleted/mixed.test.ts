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

describe('POST /api/quickbooks/webhook — payout.reconciliation_completed (mixed batched + non-batched)', () => {
  const apis = setupPayoutReconciliationTest()

  it('rejects the payout without booking a deposit and logs it FAILED (no retry)', async () => {
    await seedHealthyPortal({
      portal: { bankAccountRef: TEST_BANK_ACCOUNT_REF },
    })
    // One invoice froze batched, the other non-batched — unsupported in v1.
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
      isBatchedDeposit: false,
    })

    const res = await postWebhook(payoutReconciliationPayload)
    expect(res.status).toBe(200)

    expect(apis.intuit.createDeposit).not.toHaveBeenCalled()

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
    expect(payoutLog.status).toBe(LogStatus.FAILED)
    expect(payoutLog.shouldRetry).toBe(false)
    expect(payoutLog.errorMessage).toContain('mixes batched and non-batched')
  })
})
