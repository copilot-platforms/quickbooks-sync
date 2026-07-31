import { describe, it, expect } from 'vitest'
import { eq } from 'drizzle-orm'

import { db } from '@/db'
import { QBSyncLog } from '@/db/schema/qbSyncLogs'
import { LogStatus } from '@/app/api/core/types/log'
import User from '@/app/api/core/models/User.model'
import {
  seedHealthyPortal,
  seedPaidInvoiceForPayout,
  seedFailedPayout,
  TEST_PORTAL_ID,
  TEST_BANK_ACCOUNT_REF,
  TEST_EXPENSE_ACCOUNT_REF,
} from '@test/helpers/seed'
import { setupPaymentSucceededTest } from '@test/helpers/paymentSucceededTestSetup'

const user = { workspaceId: TEST_PORTAL_ID } as User
const lineItems = [
  { copilotInvoiceId: 'inv-cop-0001', grossAmount: 20000, feeAmount: 375 },
  { copilotInvoiceId: 'inv-cop-0002', grossAmount: 15000, feeAmount: 200 },
]

// Dynamic (not top-level) import: SyncService's graph pulls AuthService,
// which imports `next/server`'s `after`. Importing it at module-collection
// time corrupts NTARH's AsyncLocalStorage for sibling postWebhook-based
// test files sharing this worker (isolate:false). Deferring the import to
// inside each test keeps that import out of collection time.
async function syncFailedRecords() {
  const { SyncService } = await import('@/app/api/quickbooks/sync/sync.service')
  await new SyncService(user).syncFailedRecords()
}

describe('payout resync', () => {
  const apis = setupPaymentSucceededTest()

  async function seedResolvableBatchedInvoices() {
    await seedHealthyPortal({
      portal: {
        bankAccountRef: TEST_BANK_ACCOUNT_REF,
        expenseAccountRef: TEST_EXPENSE_ACCOUNT_REF,
      },
      setting: { absorbedFeeFlag: true, bankDepositFeeFlag: true },
    })
    await seedPaidInvoiceForPayout({
      copilotInvoiceId: 'inv-cop-0001',
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
  }

  it('creates the deposit on a retry once the transient cause clears', async () => {
    await seedResolvableBatchedInvoices()
    await seedFailedPayout({
      payoutId: 'po_test_1',
      lineItems,
      netAmount: 34425,
      feeCents: 575,
      arrivalDate: 1713744000,
    })

    await syncFailedRecords()

    expect(apis.intuit.createDeposit).toHaveBeenCalledTimes(1)
    const log = await db.query.QBSyncLog.findFirst({
      where: eq(QBSyncLog.copilotId, 'po_test_1'),
    })
    expect(log?.status).toBe(LogStatus.SUCCESS)
    expect(log?.quickbooksId).toBe('qb-deposit-1')
    const payoutRow = await db.query.QBPayoutSync.findFirst()
    expect(payoutRow?.qbDepositId).toBe('qb-deposit-1')
  })

  it('recovers a payout that arrived before its invoice.paid committed', async () => {
    // Failed log seeded first, invoices resolvable only now (ordering fixed).
    await seedHealthyPortal({
      portal: {
        bankAccountRef: TEST_BANK_ACCOUNT_REF,
        expenseAccountRef: TEST_EXPENSE_ACCOUNT_REF,
      },
      setting: { absorbedFeeFlag: true, bankDepositFeeFlag: true },
    })
    await seedFailedPayout({
      payoutId: 'po_test_1',
      lineItems,
      netAmount: 34425,
      feeCents: 575,
      arrivalDate: 1713744000,
      errorMessage: 'no SUCCESS INVOICE/PAID',
    })
    await seedPaidInvoiceForPayout({
      copilotInvoiceId: 'inv-cop-0001',
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

    await syncFailedRecords()

    const log = await db.query.QBSyncLog.findFirst({
      where: eq(QBSyncLog.copilotId, 'po_test_1'),
    })
    expect(log?.status).toBe(LogStatus.SUCCESS)
  })

  it('does not create a second deposit when qbDepositId is already set', async () => {
    await seedResolvableBatchedInvoices()
    await seedFailedPayout({
      payoutId: 'po_test_1',
      lineItems,
      netAmount: 34425,
      feeCents: 575,
      arrivalDate: 1713744000,
      qbDepositId: 'qb-deposit-existing',
    })

    await syncFailedRecords()

    expect(apis.intuit.createDeposit).not.toHaveBeenCalled()
    const log = await db.query.QBSyncLog.findFirst({
      where: eq(QBSyncLog.copilotId, 'po_test_1'),
    })
    expect(log?.status).toBe(LogStatus.SUCCESS)
    expect(log?.quickbooksId).toBe('qb-deposit-existing')
  })

  it('keeps a missing-context payout terminal', async () => {
    await seedResolvableBatchedInvoices()
    // FAILED log with NO qb_payout_sync row → cannot rebuild.
    await db.insert(QBSyncLog).values({
      portalId: TEST_PORTAL_ID,
      entityType: 'payout' as never,
      eventType: 'settled' as never,
      status: LogStatus.FAILED,
      copilotId: 'po_orphan',
      shouldRetry: true,
    })

    await syncFailedRecords()

    const log = await db.query.QBSyncLog.findFirst({
      where: eq(QBSyncLog.copilotId, 'po_orphan'),
    })
    expect(log?.status).toBe(LogStatus.FAILED)
    expect(log?.shouldRetry).toBe(false)
    expect(apis.intuit.createDeposit).not.toHaveBeenCalled()
  })
})
