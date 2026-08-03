import httpStatus from 'http-status'
import { and, eq, isNull } from 'drizzle-orm'

import { BaseService } from '@/app/api/core/services/base.service'
import APIError from '@/app/api/core/exceptions/api'
import { SyncLogService } from '@/app/api/quickbooks/syncLog/syncLog.service'
import { PaymentService } from '@/app/api/quickbooks/payment/payment.service'
import { TokenService } from '@/app/api/quickbooks/token/token.service'
import {
  MixedPayoutIntentError,
  TerminalPayoutError,
} from '@/app/api/quickbooks/payout/payout.errors'
import {
  QBPayoutSync,
  QBPayoutSyncSelectSchemaType,
} from '@/db/schema/qbPayoutSync'
import { PayoutLineItem } from '@/type/dto/webhook.dto'
import IntuitAPI, { IntuitAPITokensType } from '@/utils/intuitAPI'
import { AccountTypeObj } from '@/constant/qbConnection'
import { validateAccessToken } from '@/utils/auth'
import User from '@/app/api/core/models/User.model'
import { isPortalInBankDepositABTest } from '@/utils/abTesting'

export class PayoutService extends BaseService {
  private syncLogService: SyncLogService

  constructor(user: User) {
    super(user)
    this.syncLogService = new SyncLogService(user)
  }

  // Same (portalId, payoutId) updates the same row, so a re-sent payout
  // never makes a duplicate.
  async upsertPayoutSync(input: {
    payoutId: string
    lineItems: PayoutLineItem[]
    netAmount: number
    feeCents: number
    arrivalDate: number
  }): Promise<QBPayoutSyncSelectSchemaType> {
    const [row] = await this.db
      .insert(QBPayoutSync)
      .values({
        portalId: this.user.workspaceId,
        payoutId: input.payoutId,
        lineItems: input.lineItems,
        netAmount: input.netAmount,
        feeAmount: input.feeCents,
        arrivalDate: input.arrivalDate,
      })
      .onConflictDoUpdate({
        target: [QBPayoutSync.portalId, QBPayoutSync.payoutId],
        // Must match the partial unique index (only rows where deleted_at is
        // null). In drizzle-orm 0.42 that goes in `targetWhere`, not `where`.
        targetWhere: isNull(QBPayoutSync.deletedAt),
        set: {
          lineItems: input.lineItems,
          netAmount: input.netAmount,
          feeAmount: input.feeCents,
          arrivalDate: input.arrivalDate,
        },
      })
      .returning()
    return row
  }

  async getPayoutSync(
    payoutId: string,
  ): Promise<QBPayoutSyncSelectSchemaType | null> {
    const row = await this.db.query.QBPayoutSync.findFirst({
      where: and(
        eq(QBPayoutSync.portalId, this.user.workspaceId),
        eq(QBPayoutSync.payoutId, payoutId),
        isNull(QBPayoutSync.deletedAt),
      ),
    })
    return row ?? null
  }

  // Checks the payout, finds its payments, then builds and creates the deposit.
  // Neither caller claims again. Returns { depositId: null } when there is
  // nothing to deposit.
  async reconcile(
    row: QBPayoutSyncSelectSchemaType,
    qbTokenInfo: IntuitAPITokensType,
    opts: { runIdempotencyCheck: boolean },
  ): Promise<{ depositId: string | null }> {
    // AB gate: covers both callers (payout webhook + resync cron). Only fires
    // for an explicitly excluded portal (empty allowlist = all portals). Logged
    // rather than silent so a rare mid-flight exclusion is visible in Sentry.
    if (!isPortalInBankDepositABTest(this.user.workspaceId)) {
      console.info(
        `PayoutService#reconcile | AB gate off for portal ${this.user.workspaceId}; skipping deposit for payout ${row.payoutId}`,
      )
      return { depositId: null }
    }
    validateAccessToken(qbTokenInfo)

    const payoutId = row.payoutId
    // One source for the note, used to both find and create the deposit,
    // so the two can never drift apart.
    const privateNote = `Stripe payout ${payoutId}`
    const lineItems = row.lineItems
    const copilotInvoiceIds = lineItems.map((line) => line.copilotInvoiceId)
    const grossCents = lineItems.reduce(
      (sum, line) => sum + line.grossAmount,
      0,
    )
    const feeCents = lineItems.reduce((sum, line) => sum + line.feeAmount, 0)
    const netAmount = row.netAmount

    // These problems never fix themselves on retry, so fail for good.
    if (lineItems.some((line) => line.grossAmount < 0)) {
      throw new TerminalPayoutError(
        `Payout ${payoutId} contains refund lines; batched deposit unsupported in v1`,
      )
    }
    if (feeCents < 0) {
      throw new TerminalPayoutError(
        `Payout ${payoutId} has a negative aggregate fee (${feeCents}); unsupported in v1`,
      )
    }
    if (new Set(copilotInvoiceIds).size !== copilotInvoiceIds.length) {
      throw new TerminalPayoutError(
        `Payout ${payoutId} contains duplicate invoice line items`,
      )
    }

    // On resync only: reuse a deposit we already made, or find one already in QBO.
    if (opts.runIdempotencyCheck) {
      if (row.qbDepositId) return { depositId: row.qbDepositId }
      const intuitApi = new IntuitAPI(qbTokenInfo)
      const txnDate = new Date(row.arrivalDate * 1000)
        .toISOString()
        .split('T')[0]
      const existing = await intuitApi.getDepositsByTxnDate(txnDate)
      const match = existing.find(
        (deposit) => deposit.PrivateNote === privateNote,
      )
      if (match) {
        await this.db
          .update(QBPayoutSync)
          .set({ qbDepositId: match.Id })
          .where(
            and(
              eq(QBPayoutSync.id, row.id),
              eq(QBPayoutSync.portalId, this.user.workspaceId),
            ),
          )
        return { depositId: match.Id }
      }
    }

    const paymentIdByInvoice =
      await this.syncLogService.getSuccessfulPaidPaymentIds(copilotInvoiceIds)
    const unresolved = copilotInvoiceIds.filter(
      (id) => !paymentIdByInvoice.has(id),
    )
    if (unresolved.length > 0) {
      // Can retry: the invoice.paid event may just not be saved yet.
      throw new APIError(
        httpStatus.NOT_FOUND,
        `Payout ${payoutId}: no SUCCESS INVOICE/PAID sync log for invoices [${unresolved.join(', ')}]`,
      )
    }

    const allBatched = copilotInvoiceIds.every(
      (id) => paymentIdByInvoice.get(id)?.isBatchedDeposit,
    )
    const allNonBatched = copilotInvoiceIds.every(
      (id) => !paymentIdByInvoice.get(id)?.isBatchedDeposit,
    )
    // All non-batched means the fees were already booked, so nothing to deposit.
    if (allNonBatched) return { depositId: null }
    if (!allBatched) {
      throw new MixedPayoutIntentError(
        `Payout ${payoutId} mixes batched and non-batched invoices; unsupported`,
      )
    }

    if (grossCents - feeCents !== netAmount) {
      throw new TerminalPayoutError(
        `Payout ${payoutId}: deposit total ${grossCents - feeCents} != payout net ${netAmount}`,
      )
    }

    const bankAccountRef = qbTokenInfo.bankAccountRef
    if (!bankAccountRef) {
      // Can retry: works once a bank account is set in settings.
      throw new APIError(
        httpStatus.BAD_REQUEST,
        `Bank account ref is not configured for portal ${this.user.workspaceId}. Please select a bank account in the QuickBooks integration settings.`,
      )
    }

    const intuitApi = new IntuitAPI(qbTokenInfo)
    const tokenService = new TokenService(this.user)
    const verifiedBankAccountRef =
      await tokenService.checkAndUpdateAccountStatus(
        AccountTypeObj.Bank,
        qbTokenInfo.intuitRealmId,
        intuitApi,
        bankAccountRef,
      )
    const expenseAccountRef = await tokenService.checkAndUpdateAccountStatus(
      AccountTypeObj.Expense,
      qbTokenInfo.intuitRealmId,
      intuitApi,
      qbTokenInfo.expenseAccountRef,
    )

    const paymentService = new PaymentService(this.user)
    const depositId = await paymentService.createBankDepositForPayment(
      intuitApi,
      {
        lines: lineItems.map((line) => ({
          qbPaymentId: paymentIdByInvoice.get(line.copilotInvoiceId)
            ?.paymentId as string,
          amount: line.grossAmount / 100,
        })),
        feeTotal: feeCents / 100,
        bankAccountRef: verifiedBankAccountRef,
        expenseAccountRef,
        txnDate: new Date(row.arrivalDate * 1000).toISOString().split('T')[0],
        privateNote,
      },
    )

    await this.db
      .update(QBPayoutSync)
      .set({ qbDepositId: depositId })
      .where(
        and(
          eq(QBPayoutSync.id, row.id),
          eq(QBPayoutSync.portalId, this.user.workspaceId),
        ),
      )

    return { depositId }
  }
}
