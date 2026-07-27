import { describe, it, expect } from 'vitest'
import { eq } from 'drizzle-orm'

import { db } from '@/db'
import { QBSyncLog } from '@/db/schema/qbSyncLogs'

import { payoutPayload } from '@test/fixtures/payout.webhook'
import {
  seedHealthyPortal,
  TEST_BANK_ACCOUNT_REF,
  TEST_EXPENSE_ACCOUNT_REF,
} from '@test/helpers/seed'
import { setupPaymentSucceededTest } from '@test/helpers/paymentSucceededTestSetup'
import { postWebhook } from '@test/helpers/webhook'

describe('payout — no line items on the payload', () => {
  const apis = setupPaymentSucceededTest()

  it('returns 200 without creating a deposit or a payout/settled log', async () => {
    await seedHealthyPortal({
      portal: {
        bankAccountRef: TEST_BANK_ACCOUNT_REF,
        expenseAccountRef: TEST_EXPENSE_ACCOUNT_REF,
      },
      setting: { absorbedFeeFlag: true, bankDepositFeeFlag: true },
    })

    const payloadWithNoLineItems = {
      ...payoutPayload,
      data: { ...payoutPayload.data, lineItems: [] },
    }

    const res = await postWebhook(payloadWithNoLineItems)
    expect(res.status).toBe(200)

    expect(apis.intuit.createDeposit).not.toHaveBeenCalled()
    // Parse fails before any QBO round-trip, so account verification never runs.
    expect(apis.intuit.getAnAccount).not.toHaveBeenCalled()

    // The schema's `.min(1)` on lineItems fails the safeParse before the
    // handler ever calls claimWebhookEvent, so no row is written at all —
    // not even a FAILED one.
    const logs = await db
      .select()
      .from(QBSyncLog)
      .where(eq(QBSyncLog.copilotId, 'po_test_1'))
    expect(logs).toHaveLength(0)
  })
})
