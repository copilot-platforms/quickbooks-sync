import { describe, it, expect } from 'vitest'
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
import { setupPaymentSucceededTest } from '@test/helpers/paymentSucceededTestSetup'
import { postWebhook } from '@test/helpers/webhook'

describe('POST /api/quickbooks/webhook — payout.reconciliation_completed (batched deposit)', () => {
  const apis = setupPaymentSucceededTest()

  it('creates one deposit with N payment lines + fee line and logs PAYOUT/SETTLED success', async () => {
    // Healthy, non-expired token (seed.ts default tokenSetTime/expiresIn) —
    // isTokenFresh is true, so getValidQbTokens takes the extractTokens path,
    // not the OAuth-refresh path. This is the common production case and
    // guards the bankAccountRef regression in tokenRefresh.ts#extractTokens.
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

    expect(apis.intuit.createDeposit).toHaveBeenCalledTimes(1)
    const [depositPayload] = apis.intuit.createDeposit.mock.calls[0]
    expect(depositPayload.DepositToAccountRef).toEqual({
      value: TEST_BANK_ACCOUNT_REF,
    })
    expect(depositPayload.TxnDate).toBe('2024-04-22')
    expect(depositPayload.Line).toHaveLength(3) // 2 payments + 1 fee
    expect(depositPayload.Line[0]).toMatchObject({
      Amount: 200,
      LinkedTxn: [{ TxnId: 'qbpay_A', TxnType: 'Payment', TxnLineId: '0' }],
    })
    expect(depositPayload.Line[1]).toMatchObject({
      Amount: 150,
      LinkedTxn: [{ TxnId: 'qbpay_B', TxnType: 'Payment', TxnLineId: '0' }],
    })
    expect(depositPayload.Line[2]).toMatchObject({
      Amount: -5.75,
      DepositLineDetail: { AccountRef: { value: TEST_EXPENSE_ACCOUNT_REF } },
    })

    const logs = await db
      .select()
      .from(QBSyncLog)
      .where(eq(QBSyncLog.copilotId, 'po_test_1'))
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatchObject({
      portalId: TEST_PORTAL_ID,
      entityType: EntityType.PAYOUT,
      eventType: EventType.SETTLED,
      status: LogStatus.SUCCESS,
      // Deterministic: createBankDepositForPayment returns res.Deposit.Id.
      quickbooksId: 'qb-deposit-1',
    })
  })
})
