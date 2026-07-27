import { describe, it, expect } from 'vitest'
import { eq } from 'drizzle-orm'

import { db } from '@/db'
import { QBSyncLog } from '@/db/schema/qbSyncLogs'
import { EntityType } from '@/app/api/core/types/log'

import { payoutPayload } from '@test/fixtures/payout.webhook'
import {
  seedHealthyPortal,
  seedPaidInvoiceForPayout,
  TEST_COPILOT_INVOICE_ID,
} from '@test/helpers/seed'
import { setupPaymentSucceededTest } from '@test/helpers/paymentSucceededTestSetup'
import { postWebhook } from '@test/helpers/webhook'

describe('payout — every invoice froze non-batched', () => {
  const apis = setupPaymentSucceededTest()

  it('books no deposit and writes no sync log — skipped before the claim', async () => {
    await seedHealthyPortal()
    await seedPaidInvoiceForPayout({
      copilotInvoiceId: TEST_COPILOT_INVOICE_ID,
      invoiceNumber: 'INV-A',
      paymentId: 'qbpay_A',
      isBatchedDeposit: false,
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

    // No claim, no audit row — resolved before claiming.
    const payoutLogs = await db
      .select()
      .from(QBSyncLog)
      .where(eq(QBSyncLog.entityType, EntityType.PAYOUT))
    expect(payoutLogs).toHaveLength(0)
  })
})
