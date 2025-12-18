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
import { buildReturningFields } from '@/db/helper/drizzle.helper'
import {
  QBPaymentCreateSchema,
  QBPaymentCreateSchemaType,
  QBPaymentSync,
  QBPaymentUpdateSchema,
  QBPaymentUpdateSchemaType,
} from '@/db/schema/qbPaymentSync'
import { InvoiceResponse, WhereClause } from '@/type/common'
import {
  QBPaymentCreatePayloadSchema,
  QBPaymentCreatePayloadType,
  QBPurchaseCreatePayloadSchema,
  QBPurchaseCreatePayloadType,
} from '@/type/dto/intuitAPI.dto'
import { PaymentSucceededResponseType } from '@/type/dto/webhook.dto'
import { getMessageAndCodeFromError } from '@/utils/error'
import IntuitAPI, { IntuitAPITokensType } from '@/utils/intuitAPI'
import {
  getDeletedAtForAuthAccountCategoryLog,
  getCategory,
} from '@/utils/synclog'
import dayjs from 'dayjs'

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
          category: getCategory(errorWithCode),
          deletedAt: getDeletedAtForAuthAccountCategoryLog(errorWithCode),
        },
        LogStatus.FAILED,
      )
      console.error('PaymentService#webhookPaymentSucceeded | Error =', err)
      return false
    }
  }

  async createExpenseForAbsorbedFees(
    payload: QBPurchaseCreatePayloadType,
    intuitApi: IntuitAPI,
    id: string,
  ) {
    const parsedPayload = QBPurchaseCreatePayloadSchema.parse(payload)

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
          invoiceNumber: payload.DocNumber,
        },
        EventType.SUCCEEDED,
        EntityType.PAYMENT,
        {
          feeAmount: (payload.Line[0].Amount * 100).toFixed(2),
          remark: 'Absorbed fees',
          qbItemName: 'Assembly Fees',
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

  async webhookPaymentSucceeded(
    parsedPaymentSucceedResource: PaymentSucceededResponseType,
    qbTokenInfo: IntuitAPITokensType,
    invoice: InvoiceResponse | undefined,
  ): Promise<void> {
    const paymentResource = parsedPaymentSucceedResource.data
    const payload = {
      PaymentType: 'Cash' as const,
      AccountRef: {
        value: qbTokenInfo.assetAccountRef,
      },
      DocNumber: invoice?.number || '',
      TxnDate: dayjs(paymentResource.createdAt).format('YYYY-MM-DD'), // the date format for due date follows XML Schema standard (YYYY-MM-DD). For more info: https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/purchase#the-purchase-object
      Line: [
        {
          DetailType: 'AccountBasedExpenseLineDetail' as const,
          Amount: paymentResource.feeAmount.paidByPlatform / 100,
          AccountBasedExpenseLineDetail: {
            AccountRef: {
              value: qbTokenInfo.expenseAccountRef,
            },
          },
        },
      ],
    }
    const intuitApi = new IntuitAPI(qbTokenInfo)
    await this.createExpenseForAbsorbedFees(
      payload,
      intuitApi,
      parsedPaymentSucceedResource.data.id,
    )
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
      category?: FailedRecordCategoryType
      deletedAt?: Date
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
