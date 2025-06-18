import { BaseService } from '@/app/api/core/services/base.service'
import { EntityType, EventType, LogStatus } from '@/app/api/core/types/log'
import { ExpenseService } from '@/app/api/quickbooks/expense/expense.service'
import { SyncLogService } from '@/app/api/quickbooks/syncLog/syncLog.service'
import { buildReturningFields } from '@/db/helper/drizzle.helper'
import {
  QBPaymentCreateSchema,
  QBPaymentCreateSchemaType,
  QBPaymentSync,
  QBPaymentUpdateSchema,
  QBPaymentUpdateSchemaType,
} from '@/db/schema/qbPaymentSync'
import { QBSyncLogCreateSchemaType } from '@/db/schema/qbSyncLogs'
import { InvoiceResponse, WhereClause } from '@/type/common'
import {
  QBPaymentCreatePayloadSchema,
  QBPaymentCreatePayloadType,
  QBPurchaseCreatePayloadSchema,
  QBPurchaseCreatePayloadType,
} from '@/type/dto/intuitAPI.dto'
import { PaymentSucceededResponseType } from '@/type/dto/webhook.dto'
import IntuitAPI, { IntuitAPITokensType } from '@/utils/intuitAPI'
import dayjs from 'dayjs'

export class PaymentService extends BaseService {
  async createQBPayment(
    payload: QBPaymentCreateSchemaType,
    returningFields?: (keyof typeof QBPaymentSync)[],
  ) {
    const parsedInsertPayload = QBPaymentCreateSchema.parse(payload)
    const query = this.db.insert(QBPaymentSync).values(parsedInsertPayload)

    const [paymentSync] =
      returningFields && returningFields.length > 0
        ? await query.returning(
            buildReturningFields(QBPaymentSync, returningFields),
          )
        : await query

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

    const [paymentSync] =
      returningFields && returningFields.length > 0
        ? await query.returning(
            buildReturningFields(QBPaymentSync, returningFields),
          )
        : await query.returning()

    return paymentSync
  }

  async createPaymentAndSync(
    intuitApi: IntuitAPI,
    qbPaymentPayload: QBPaymentCreatePayloadType,
    invoiceNumber: string,
    invoiceId: string,
  ): Promise<boolean> {
    const parsedQbPayload = QBPaymentCreatePayloadSchema.parse(qbPaymentPayload)
    const syncLogService = new SyncLogService(this.user)
    const syncLogPayload: QBSyncLogCreateSchemaType = {
      portalId: this.user.workspaceId,
      entityType: EntityType.INVOICE,
      eventType: EventType.PAID,
      status: LogStatus.SUCCESS,
      copilotId: invoiceId,
      invoiceNumber,
      amount: (qbPaymentPayload.Line[0].Amount * 100).toFixed(2),
    }

    // to save error sync log when payment creation fails in QB
    try {
      const qbPaymentRes = await intuitApi.createPayment(parsedQbPayload)
      // store success sync log for payment
      syncLogPayload.syncDate = dayjs().format('YYYY-MM-DD')
      syncLogPayload.syncTime = dayjs().format('HH:mm:ss')
      syncLogPayload.quickbooksId = qbPaymentRes.Payment.Id
      await syncLogService.updateOrCreateQBSyncLog(syncLogPayload)

      return true
    } catch (err: unknown) {
      syncLogPayload.status = LogStatus.FAILED
      await syncLogService.updateOrCreateQBSyncLog(syncLogPayload)
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
      const syncLogService = new SyncLogService(this.user)
      await syncLogService.updateOrCreateQBSyncLog({
        portalId: this.user.workspaceId,
        entityType: EntityType.PAYMENT,
        eventType: EventType.SUCCEEDED,
        status: LogStatus.SUCCESS,
        copilotId: id,
        syncDate: dayjs().format('YYYY-MM-DD'),
        syncTime: dayjs().format('HH:mm:ss'),
        quickbooksId: res.Purchase.Id,
        invoiceNumber: payload.DocNumber,
        amount: (payload.Line[0].Amount * 100).toFixed(2),
        remark: 'Absorbed fees',
      })
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
}
