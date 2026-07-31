import { describe, it, expect } from 'vitest'
import { and, eq } from 'drizzle-orm'

import { PayoutService } from '@/app/api/quickbooks/payout/payout.service'
import {
  TerminalPayoutError,
  MixedPayoutIntentError,
} from '@/app/api/quickbooks/payout/payout.errors'
import { QBPayoutSync } from '@/db/schema/qbPayoutSync'
import { db } from '@/db'
import User from '@/app/api/core/models/User.model'
import { getValidQbTokens } from '@/utils/tokenRefresh'
import {
  seedHealthyPortal,
  seedPaidInvoiceForPayout,
  TEST_PORTAL_ID,
  TEST_BANK_ACCOUNT_REF,
  TEST_EXPENSE_ACCOUNT_REF,
} from '@test/helpers/seed'
import { setupPaymentSucceededTest } from '@test/helpers/paymentSucceededTestSetup'

const user = { workspaceId: TEST_PORTAL_ID } as User

// No `@test/helpers/tokens` helper exists. AuthService.getQBPortalConnection
// would be the obvious pick, but it transitively imports next/server's
// `after` (auth.service.ts), which corrupts NTARH's AsyncLocalStorage for
// every other postWebhook-based test sharing this worker (isolate: false) —
// the same class of bug test/integration/setup.ts already documents and
// shims for afterIfAvailable. getValidQbTokens is the exact function
// getQBPortalConnection delegates to for a healthy/synced seeded portal
// (our fixtures always have isEnabled/syncFlag true), with no next/server
// in its import graph — a plain DB read, IntuitAPI already mocked.
async function getQBTokens() {
  return getValidQbTokens(TEST_PORTAL_ID)
}

async function insertPayoutRow(overrides = {}) {
  const [row] = await db
    .insert(QBPayoutSync)
    .values({
      portalId: TEST_PORTAL_ID,
      payoutId: 'po_test_1',
      lineItems: [
        {
          copilotInvoiceId: 'inv-cop-0001',
          grossAmount: 20000,
          feeAmount: 375,
        },
        {
          copilotInvoiceId: 'inv-cop-0002',
          grossAmount: 15000,
          feeAmount: 200,
        },
      ],
      netAmount: 34425,
      feeAmount: 575,
      arrivalDate: 1713744000,
      ...overrides,
    })
    .returning()
  return row
}

describe('PayoutService.reconcile', () => {
  const apis = setupPaymentSucceededTest()

  async function seedResolvableBatchedPayout() {
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

  it('creates a deposit for an all-batched payout and persists qbDepositId', async () => {
    await seedResolvableBatchedPayout()
    const row = await insertPayoutRow()

    const { depositId } = await new PayoutService(user).reconcile(
      row,
      await getQBTokens(),
      { runIdempotencyCheck: false },
    )

    expect(depositId).toBe('qb-deposit-1')
    expect(apis.intuit.createDeposit).toHaveBeenCalledTimes(1)
    const saved = await db.query.QBPayoutSync.findFirst()
    expect(saved?.qbDepositId).toBe('qb-deposit-1')
  })

  it('throws NOT_FOUND (retryable) when an invoice payment is unresolved', async () => {
    await seedHealthyPortal({
      portal: {
        bankAccountRef: TEST_BANK_ACCOUNT_REF,
        expenseAccountRef: TEST_EXPENSE_ACCOUNT_REF,
      },
      setting: { absorbedFeeFlag: true, bankDepositFeeFlag: true },
    })
    // Only one of two invoices seeded → the other is unresolved.
    await seedPaidInvoiceForPayout({
      copilotInvoiceId: 'inv-cop-0001',
      invoiceNumber: 'INV-A',
      paymentId: 'qbpay_A',
      isBatchedDeposit: true,
    })
    const row = await insertPayoutRow()

    await expect(
      new PayoutService(user).reconcile(row, await getQBTokens(), {
        runIdempotencyCheck: false,
      }),
    ).rejects.toThrow(/no SUCCESS INVOICE\/PAID/)
    expect(apis.intuit.createDeposit).not.toHaveBeenCalled()
  })

  it('throws TerminalPayoutError on a sum mismatch', async () => {
    await seedResolvableBatchedPayout()
    const row = await insertPayoutRow({ netAmount: 99999 })

    await expect(
      new PayoutService(user).reconcile(row, await getQBTokens(), {
        runIdempotencyCheck: false,
      }),
    ).rejects.toBeInstanceOf(TerminalPayoutError)
  })

  it('throws MixedPayoutIntentError when intents are mixed', async () => {
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
      isBatchedDeposit: false,
    })
    const row = await insertPayoutRow()

    await expect(
      new PayoutService(user).reconcile(row, await getQBTokens(), {
        runIdempotencyCheck: false,
      }),
    ).rejects.toBeInstanceOf(MixedPayoutIntentError)
  })

  it('returns depositId null when all invoices are non-batched', async () => {
    await seedHealthyPortal({
      portal: {
        bankAccountRef: TEST_BANK_ACCOUNT_REF,
        expenseAccountRef: TEST_EXPENSE_ACCOUNT_REF,
      },
      setting: { absorbedFeeFlag: true, bankDepositFeeFlag: false },
    })
    await seedPaidInvoiceForPayout({
      copilotInvoiceId: 'inv-cop-0001',
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
    const row = await insertPayoutRow()

    const { depositId } = await new PayoutService(user).reconcile(
      row,
      await getQBTokens(),
      { runIdempotencyCheck: false },
    )
    expect(depositId).toBeNull()
    expect(apis.intuit.createDeposit).not.toHaveBeenCalled()
  })

  it('idempotency: skips creation when qbDepositId is already set', async () => {
    await seedResolvableBatchedPayout()
    const row = await insertPayoutRow({ qbDepositId: 'qb-deposit-existing' })

    const { depositId } = await new PayoutService(user).reconcile(
      row,
      await getQBTokens(),
      { runIdempotencyCheck: true },
    )
    expect(depositId).toBe('qb-deposit-existing')
    expect(apis.intuit.createDeposit).not.toHaveBeenCalled()
  })

  it('idempotency: reconciles to an existing QBO deposit found by note', async () => {
    await seedResolvableBatchedPayout()
    const row = await insertPayoutRow()
    apis.intuit.getDepositsByTxnDate.mockResolvedValueOnce([
      { Id: 'qb-deposit-found', PrivateNote: 'Stripe payout po_test_1' },
    ])

    const { depositId } = await new PayoutService(user).reconcile(
      row,
      await getQBTokens(),
      { runIdempotencyCheck: true },
    )
    expect(depositId).toBe('qb-deposit-found')
    expect(apis.intuit.createDeposit).not.toHaveBeenCalled()
    const saved = await db.query.QBPayoutSync.findFirst()
    expect(saved?.qbDepositId).toBe('qb-deposit-found')
  })
})

describe('PayoutService.upsertPayoutSync', () => {
  setupPaymentSucceededTest()

  it('re-delivery with the same payoutId updates the row instead of inserting a duplicate', async () => {
    const service = new PayoutService(user)

    // Exercises the ON CONFLICT arbiter directly: the unique index is
    // partial (`WHERE deleted_at IS NULL`), so a wrong predicate here throws
    // "no unique or exclusion constraint matching the ON CONFLICT specification"
    // on this very call rather than silently inserting a duplicate row.
    await service.upsertPayoutSync({
      payoutId: 'po_test_1',
      lineItems: [
        {
          copilotInvoiceId: 'inv-cop-0001',
          grossAmount: 20000,
          feeAmount: 375,
        },
      ],
      netAmount: 19625,
      feeCents: 375,
      arrivalDate: 1713744000,
    })
    await service.upsertPayoutSync({
      payoutId: 'po_test_1',
      lineItems: [
        {
          copilotInvoiceId: 'inv-cop-0001',
          grossAmount: 25000,
          feeAmount: 500,
        },
      ],
      netAmount: 24500,
      feeCents: 500,
      arrivalDate: 1713744000,
    })

    const rows = await db
      .select()
      .from(QBPayoutSync)
      .where(
        and(
          eq(QBPayoutSync.portalId, TEST_PORTAL_ID),
          eq(QBPayoutSync.payoutId, 'po_test_1'),
        ),
      )

    expect(rows).toHaveLength(1)
    expect(rows[0].netAmount).toBe(24500)
    expect(rows[0].feeAmount).toBe(500)
    expect(rows[0].lineItems).toEqual([
      { copilotInvoiceId: 'inv-cop-0001', grossAmount: 25000, feeAmount: 500 },
    ])
  })
})
