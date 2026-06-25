import { describe, it, expect } from 'vitest'
import { eq } from 'drizzle-orm'

import { db } from '@/db'
import { QBSyncLog } from '@/db/schema/qbSyncLogs'
import { EntityType, EventType, LogStatus } from '@/app/api/core/types/log'

import { paymentSucceededPayload } from '@test/fixtures/paymentSucceeded.webhook'
import {
  seedHealthyPortal,
  seedQBInvoiceSync,
  TEST_PORTAL_ID,
  TEST_INVOICE_NUMBER,
  TEST_COPILOT_INVOICE_ID,
  TEST_COPILOT_PAYMENT_ID,
  TEST_QB_PURCHASE_ID,
  TEST_ASSET_ACCOUNT_REF,
  TEST_EXPENSE_ACCOUNT_REF,
} from '@test/helpers/seed'
import { setupPaymentSucceededTest } from '@test/helpers/paymentSucceededTestSetup'
import { postWebhook } from '@test/helpers/webhook'

describe('POST /api/quickbooks/webhook — payment.succeeded (absorbed-fee expense recorded)', () => {
  const apis = setupPaymentSucceededTest()

  it('records the absorbed fee as a QuickBooks expense and logs the sync as successful', async () => {
    await seedHealthyPortal({ setting: { absorbedFeeFlag: true } })
    await seedQBInvoiceSync()

    const res = await postWebhook(paymentSucceededPayload)
    expect(res.status).toBe(200)

    // For (payment, succeeded) the polymorphic `quickbooks_id` column holds the
    // QBO Purchase id, not a payment id. See memory/project_qb_sync_logs_semantics.md.
    const logs = await db
      .select()
      .from(QBSyncLog)
      .where(eq(QBSyncLog.copilotId, TEST_COPILOT_PAYMENT_ID))
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatchObject({
      portalId: TEST_PORTAL_ID,
      entityType: EntityType.PAYMENT,
      eventType: EventType.SUCCEEDED,
      status: LogStatus.SUCCESS,
      copilotId: TEST_COPILOT_PAYMENT_ID,
      quickbooksId: TEST_QB_PURCHASE_ID,
      feeAmount: '2500.00',
      qbItemName: 'Assembly Fees',
      remark: 'Absorbed fees',
    })

    expect(apis.copilot.getInvoice).toHaveBeenCalledWith(
      TEST_COPILOT_INVOICE_ID,
    )
    expect(apis.intuit.getAnAccount).toHaveBeenCalledTimes(2) // asset + expense
    expect(apis.intuit.getAnAccount).toHaveBeenCalledWith(
      undefined, // account name
      TEST_ASSET_ACCOUNT_REF, // account id
      true, // includeInactive
    )
    expect(apis.intuit.getAnAccount).toHaveBeenCalledWith(
      undefined,
      TEST_EXPENSE_ACCOUNT_REF,
      true,
    )
    expect(apis.intuit.createPurchase).toHaveBeenCalledTimes(1)
    expect(apis.intuit.deletePurchase).not.toHaveBeenCalled()

    const [purchasePayload] = apis.intuit.createPurchase.mock.calls[0]
    expect(purchasePayload).toMatchObject({
      PaymentType: 'Cash',
      AccountRef: { value: TEST_ASSET_ACCOUNT_REF },
      DocNumber: TEST_INVOICE_NUMBER,
      TxnDate: '2024-02-21',
    })
    expect(purchasePayload.Line[0]).toMatchObject({
      DetailType: 'AccountBasedExpenseLineDetail',
      Amount: 25,
      AccountBasedExpenseLineDetail: {
        AccountRef: { value: TEST_EXPENSE_ACCOUNT_REF },
      },
    })
  })
})
