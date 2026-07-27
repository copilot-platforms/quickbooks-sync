import { describe, it, expect, vi } from 'vitest'
import { eq } from 'drizzle-orm'

import { db } from '@/db'
import { QBSyncLog } from '@/db/schema/qbSyncLogs'

import { paymentSucceededPayload } from '@test/fixtures/paymentSucceeded.webhook'
import {
  seedHealthyPortal,
  seedQBInvoiceSync,
  TEST_COPILOT_PAYMENT_ID,
} from '@test/helpers/seed'
import { createMockCopilotAPI } from '@test/helpers/mocks'
import { setupPaymentSucceededTest } from '@test/helpers/paymentSucceededTestSetup'
import { postWebhook } from '@test/helpers/webhook'

describe('POST /api/quickbooks/webhook — payment.succeeded (Copilot returns no invoice)', () => {
  const apis = setupPaymentSucceededTest(() => ({
    copilot: createMockCopilotAPI({
      getInvoice: vi.fn().mockResolvedValue(undefined),
    }),
  }))

  it('returns a 404 and does not call QuickBooks when Copilot cannot find the invoice', async () => {
    await seedHealthyPortal({ setting: { absorbedFeeFlag: true } })
    await seedQBInvoiceSync()

    const res = await postWebhook(paymentSucceededPayload)
    // The not-found throw happens before the claim (Copilot fetch now runs
    // pre-claim so the frozen batched-defer check can read the invoice-sync
    // row first) and propagates to withErrorHandler, which surfaces it as 404.
    expect(res.status).toBe(404)

    // No row at all is written — the throw happens before claimWebhookEvent.
    const logs = await db
      .select()
      .from(QBSyncLog)
      .where(eq(QBSyncLog.copilotId, TEST_COPILOT_PAYMENT_ID))
    expect(logs).toHaveLength(0)

    expect(apis.intuit.createPurchase).not.toHaveBeenCalled()
    expect(apis.intuit.deletePurchase).not.toHaveBeenCalled()
    // Throw happens before any QBO round-trip, so account verification never runs.
    expect(apis.intuit.getAnAccount).not.toHaveBeenCalled()
  })
})
