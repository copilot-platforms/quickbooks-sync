import { describe, it, expect } from 'vitest'
import { eq } from 'drizzle-orm'

import { db } from '@/db'
import { QBSyncLog } from '@/db/schema/qbSyncLogs'
import { EntityType } from '@/app/api/core/types/log'

import {
  payoutReconciliationPayload,
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

describe('POST /api/quickbooks/webhook — payout.reconciliation_completed (all invoices non-batched)', () => {
  const apis = setupPayoutReconciliationTest()

  it('books no deposit and writes no sync log — skipped before the claim', async () => {
    await seedHealthyPortal({
      portal: { bankAccountRef: TEST_BANK_ACCOUNT_REF },
    })
    await seedPaidInvoiceForPayout({
      copilotInvoiceId: TEST_COPILOT_INVOICE_ID_A,
      invoiceNumber: 'INV-A',
      paymentId: 'qb-pay-A',
      isBatchedDeposit: false,
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

    // No claim, no audit row — the two seeded INVOICE/PAID logs are all that remain.
    const payoutLogs = await db
      .select()
      .from(QBSyncLog)
      .where(eq(QBSyncLog.entityType, EntityType.PAYOUT))
    expect(payoutLogs).toHaveLength(0)
  })
})
