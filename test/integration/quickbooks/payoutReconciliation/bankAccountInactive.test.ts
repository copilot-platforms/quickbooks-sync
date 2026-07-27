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

describe('payout — configured bank account is inactive in QuickBooks', () => {
  const apis = setupPaymentSucceededTest(() => ({
    intuit: createMockIntuitAPI({
      // Only the bank ref comes back inactive; the expense ref (queried in
      // the same flow) must stay on the default active response so this
      // test exercises the bank-reactivation path specifically.
      getAnAccount: vi
        .fn()
        .mockImplementation(async (_name?: string, id?: string) => {
          if (id === TEST_BANK_ACCOUNT_REF) {
            return {
              Id: TEST_BANK_ACCOUNT_REF,
              Name: 'Business Checking',
              SyncToken: '0',
              Active: false,
            }
          }
          return {
            Id: id,
            Name: 'Sales of Product Income',
            SyncToken: '0',
            Active: true,
          }
        }),
      updateAccount: vi.fn().mockResolvedValue({
        Account: {
          Id: TEST_BANK_ACCOUNT_REF,
          Name: 'Business Checking',
          SyncToken: '1',
          Active: true,
        },
      }),
    }),
  }))

  it('reactivates the bank account and still creates the deposit', async () => {
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

    expect(apis.intuit.updateAccount).toHaveBeenCalledTimes(1)
    expect(apis.intuit.updateAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        Id: TEST_BANK_ACCOUNT_REF,
        SyncToken: '0',
        Active: true,
      }),
    )

    expect(apis.intuit.createDeposit).toHaveBeenCalledTimes(1)
    const [depositPayload] = apis.intuit.createDeposit.mock.calls[0]
    expect(depositPayload.DepositToAccountRef).toEqual({
      value: TEST_BANK_ACCOUNT_REF,
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
    })
  })
})
