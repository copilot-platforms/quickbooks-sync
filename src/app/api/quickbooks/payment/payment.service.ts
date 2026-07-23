import APIError from '@/app/api/core/exceptions/api'
import User from '@/app/api/core/models/User.model'
import { BaseService } from '@/app/api/core/services/base.service'
import { SyncableEntity } from '@/app/api/core/types/invoice'
import {
  FailedRecordCategoryType,
  EntityType,
  EventType,
  LogStatus,
} from '@/app/api/core/types/log'
import { SyncLogService } from '@/app/api/quickbooks/syncLog/syncLog.service'
import { TokenService } from '@/app/api/quickbooks/token/token.service'
import { AccountTypeObj } from '@/constant/qbConnection'
import { buildReturningFields } from '@/db/helper/drizzle.helper'
import {
  QBPaymentCreateSchema,
  QBPaymentCreateSchemaType,
  QBPaymentSync,
  QBPaymentUpdateSchema,
  QBPaymentUpdateSchemaType,
} from '@/db/schema/qbPaymentSync'
import { WhereClause } from '@/type/common'
import {
  QBDepositCreatePayloadSchema,
  QBDepositCreatePayloadType,
  QBPaymentCreatePayloadSchema,
  QBPaymentCreatePayloadType,
  QBPurchaseCreatePayloadSchema,
  QBPurchaseCreatePayloadType,
} from '@/type/dto/intuitAPI.dto'
import { PaymentSucceededResponseType } from '@/type/dto/webhook.dto'
import { getMessageAndCodeFromError } from '@/utils/error'
import IntuitAPI, { IntuitAPITokensType } from '@/utils/intuitAPI'
import { getCategory, getShouldRetryForCategory } from '@/utils/synclog'
import { addSyncBreadcrumb } from '@/utils/sentry'
import dayjs from 'dayjs'
import { z } from 'zod'
import httpStatus from 'http-status'
import CustomLogger from '@/utils/logger'

export class PaymentService extends BaseService {
  private syncLogService: SyncLogService
  constructor(user: User) {
    super(user)
    this.syncLogService = new SyncLogService(user)
  }

  async createQBPayment(
    payload: QBPaymentCreateSchemaType,
    returningFields?: (keyof typeof QBPaymentSync)[],
  ) {
    const parsedInsertPayload = QBPaymentCreateSchema.parse(payload)
    const query = this.db.insert(QBPaymentSync).values(parsedInsertPayload)

    const [paymentSync] = returningFields?.length
      ? await query.returning(
          buildReturningFields(QBPaymentSync, returningFields),
        )
      : await query.returning()

    return paymentSync
  }

  async updateQBPayment(
    payload: QBPaymentUpdateSchemaType,
    conditions: WhereClause,
    returningFields?: (keyof typeof QBPaymentSync)[],
  ) {
    const parsedInsertPayload = QBPaymentUpdateSchema.parse(payload)

    const query = this.db
      .update(QBPaymentSync)
      .set(parsedInsertPayload)
      .where(conditions)

    const [paymentSync] = returningFields?.length
      ? await query.returning(
          buildReturningFields(QBPaymentSync, returningFields),
        )
      : await query.returning()

    return paymentSync
  }

  async createPaymentAndSync(
    intuitApi: IntuitAPI,
    qbPaymentPayload: QBPaymentCreatePayloadType,
    invoiceInfo: {
      invoiceNumber: string
      invoiceId: string
      taxAmount?: string
    },
    recipientInfo: {
      displayName: string | null
      email: string | null
    },
  ): Promise<boolean> {
    const parsedQbPayload = QBPaymentCreatePayloadSchema.parse(qbPaymentPayload)
    addSyncBreadcrumb('Creating payment in QBO', {
      invoiceNumber: invoiceInfo.invoiceNumber,
    })
    // to save error sync log when payment creation fails in QB
    try {
      const qbPaymentRes = await intuitApi.createPayment(parsedQbPayload)
      const invoiceInfoLog = {
        qbInvoiceId: qbPaymentRes.Payment.Id,
        invoiceNumber: invoiceInfo.invoiceNumber,
      }
      await this.logSync(
        invoiceInfo.invoiceId,
        invoiceInfoLog,
        EventType.PAID,
        EntityType.INVOICE,
        {
          amount: (qbPaymentPayload.Line[0].Amount * 100).toFixed(2),
          taxAmount: invoiceInfo.taxAmount,
          customerName: recipientInfo.displayName,
          customerEmail: recipientInfo.email,
          errorMessage: '',
        },
      )

      return true
    } catch (err: unknown) {
      const errorWithCode = getMessageAndCodeFromError(err)
      const errorMessage = errorWithCode.message

      await this.logSync(
        invoiceInfo.invoiceId,
        {
          qbInvoiceId: null,
          invoiceNumber: invoiceInfo.invoiceNumber,
        },
        EventType.PAID,
        EntityType.INVOICE,
        {
          amount: (qbPaymentPayload.Line[0].Amount * 100).toFixed(2),
          taxAmount: invoiceInfo.taxAmount,
          customerName: recipientInfo.displayName,
          customerEmail: recipientInfo.email,
          errorMessage,
          errorCode: errorWithCode.code?.toString(),
          shouldRetry: getShouldRetryForCategory(errorWithCode),
          category: getCategory(errorWithCode),
        },
        LogStatus.FAILED,
      )
      console.error('PaymentService#webhookPaymentSucceeded | Error =', err)
      return false
    }
  }

  async createExpenseForAbsorbedFees({
    payload,
    invoiceNumber,
    intuitApi,
    id,
  }: {
    payload: QBPurchaseCreatePayloadType
    invoiceNumber: string
    intuitApi: IntuitAPI
    id: string
  }) {
    const parsedPayload = QBPurchaseCreatePayloadSchema.parse(payload)

    addSyncBreadcrumb('Creating expense for absorbed fees')
    console.info(
      'PaymentService#webhookPaymentSucceeded | Creating expense for absorbed fees',
    )
    const res = await intuitApi.createPurchase(parsedPayload)

    try {
      // store success sync log for payment
      await this.logSync(
        id,
        {
          qbInvoiceId: res.Purchase.Id,
          invoiceNumber,
        },
        EventType.SUCCEEDED,
        EntityType.PAYMENT,
        {
          feeAmount: (payload.Line[0].Amount * 100).toFixed(2),
          remark: 'Absorbed fees',
          qbItemName: 'Assembly Fees',
          errorMessage: '',
        },
      )
    } catch (error: unknown) {
      // revert the expense if error
      console.info('Reverting the added expense from QuickBooks')
      const deletePayload = {
        SyncToken: res.Purchase?.SyncToken,
        Id: res.Purchase?.Id,
      }
      await intuitApi.deletePurchase(deletePayload)
      throw error
    }
  }

  async createBankDepositForPayment(
    intuitApi: IntuitAPI,
    opts: {
      lines: Array<{ qbPaymentId: string; amount: number }>
      feeTotal: number
      bankAccountRef: string
      expenseAccountRef: string
      txnDate: string
      privateNote: string
    },
  ): Promise<string> {
    addSyncBreadcrumb('Creating batched bank deposit in QBO', {
      privateNote: opts.privateNote,
      lineCount: opts.lines.length,
      feeTotal: opts.feeTotal,
    })

    const paymentLines: Required<QBDepositCreatePayloadType>['Line'] =
      opts.lines.map((line) => ({
        Amount: line.amount,
        LinkedTxn: [
          {
            TxnId: line.qbPaymentId,
            TxnType: 'Payment' as const,
            TxnLineId: '0',
          },
        ],
      }))

    // feeTotal is always >= 0 (caller rejects negative): 0 = no fee line.
    if (opts.feeTotal > 0) {
      paymentLines.push({
        Amount: -opts.feeTotal,
        DetailType: 'DepositLineDetail' as const,
        DepositLineDetail: {
          AccountRef: { value: opts.expenseAccountRef },
        },
        Description: 'Stripe processing fees',
      })
    }

    const depositPayload: QBDepositCreatePayloadType = {
      DepositToAccountRef: { value: opts.bankAccountRef },
      PrivateNote: opts.privateNote,
      TxnDate: opts.txnDate,
      Line: paymentLines,
    }

    const parsedPayload = QBDepositCreatePayloadSchema.parse(depositPayload)
    const res = await intuitApi.createDeposit(parsedPayload)

    CustomLogger.info({
      obj: {
        depositId: res.Deposit?.Id,
        lineCount: opts.lines.length,
        feeTotal: opts.feeTotal,
      },
      message: `PaymentService#createBankDepositForPayment | Batched bank deposit created (${opts.privateNote})`,
    })
    addSyncBreadcrumb('Batched bank deposit created in QBO', {
      depositId: res.Deposit?.Id,
    })

    return res.Deposit.Id
  }

  async webhookPaymentSucceeded({
    parsedPaymentSucceedResource,
    qbTokenInfo,
    qbDocNumber,
    invoiceNumber,
  }: {
    parsedPaymentSucceedResource: PaymentSucceededResponseType
    qbTokenInfo: IntuitAPITokensType
    qbDocNumber: string
    invoiceNumber: string
  }): Promise<void> {
    const paymentResource = parsedPaymentSucceedResource.data
    addSyncBreadcrumb('Payment succeeded flow started', {
      paymentId: paymentResource.id,
      invoiceId: paymentResource.invoiceId,
    })

    if (!paymentResource.feeAmount)
      throw new APIError(httpStatus.BAD_REQUEST, 'Fee amount is not found')

    const intuitApi = new IntuitAPI(qbTokenInfo)
    const tokenService = new TokenService(this.user)
    const assetAccountRef = await tokenService.checkAndUpdateAccountStatus(
      AccountTypeObj.Asset,
      qbTokenInfo.intuitRealmId,
      intuitApi,
      qbTokenInfo.assetAccountRef,
    )
    const expenseAccountRef = await tokenService.checkAndUpdateAccountStatus(
      AccountTypeObj.Expense,
      qbTokenInfo.intuitRealmId,
      intuitApi,
      qbTokenInfo.expenseAccountRef,
    )
    const payload = {
      PaymentType: 'Cash' as const,
      AccountRef: {
        value: z.string().parse(assetAccountRef),
      },
      DocNumber: qbDocNumber,
      TxnDate: dayjs(paymentResource.createdAt).format('YYYY-MM-DD'), // the date format for due date follows XML Schema standard (YYYY-MM-DD). For more info: https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/purchase#the-purchase-object
      Line: [
        {
          DetailType: 'AccountBasedExpenseLineDetail' as const,
          Amount: paymentResource.feeAmount.paidByPlatform / 100,
          AccountBasedExpenseLineDetail: {
            AccountRef: {
              value: z.string().parse(expenseAccountRef),
            },
          },
        },
      ],
    }
    await this.createExpenseForAbsorbedFees({
      payload,
      invoiceNumber,
      intuitApi,
      id: parsedPaymentSucceedResource.data.id,
    })
  }

  private async logSync(
    copilotId: string,
    syncedInvoice: SyncableEntity,
    eventType: EventType,
    entityType: EntityType,
    opts: {
      amount?: string
      taxAmount?: string
      feeAmount?: string
      customerName?: string | null
      customerEmail?: string | null
      remark?: string
      qbItemName?: string
      errorMessage?: string
      errorCode?: string
      category?: FailedRecordCategoryType
      shouldRetry?: boolean
    },
    status: LogStatus = LogStatus.SUCCESS,
  ) {
    await this.syncLogService.updateOrCreateQBSyncLog({
      portalId: this.user.workspaceId,
      entityType,
      eventType,
      status,
      copilotId,
      syncAt: dayjs().toDate(),
      quickbooksId: syncedInvoice.qbInvoiceId,
      invoiceNumber: syncedInvoice.invoiceNumber,
      ...opts,
    })
  }
}
