import { BaseService } from '@/app/api/core/services/base.service'
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
  QBPaymentCreatePayloadType,
  QBPurchaseCreatePayloadSchema,
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
  ) {
    const qbPaymentRes = await intuitApi.createPayment(qbPaymentPayload)
    try {
      const paymentPayload = {
        portalId: this.user.workspaceId,
        invoiceNumber,
        totalAmount: (qbPaymentRes.Payment.TotalAmt * 100).toString(), // to cents
        qbPaymentId: qbPaymentRes.Payment.Id,
        qbSyncToken: qbPaymentRes.Payment.SyncToken,
      }
      await this.createQBPayment(paymentPayload, ['id'])
    } catch (error: unknown) {
      // revert the payment if error
      const deletePayload = {
        SyncToken: qbPaymentRes.Payment.SyncToken,
        Id: qbPaymentRes.Payment.Id,
      }
      await intuitApi.deletePayment(deletePayload)

      // TODO: track the missed payment and later backfill
      throw error
    }
  }

  async webhookPaymentSucceeded(
    parsedPaymentSucceedResource: PaymentSucceededResponseType,
    qbTokenInfo: IntuitAPITokensType,
  ): Promise<void> {
    const paymentResource = parsedPaymentSucceedResource.data
    const payload = {
      PaymentType: 'Cash' as const,
      AccountRef: {
        value: qbTokenInfo.assetAccountRef,
      },
      // DocNumber: "placeholder", // TODO: replace with invoice number
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

    const parsedPayload = QBPurchaseCreatePayloadSchema.parse(payload)
    const intuitApi = new IntuitAPI(qbTokenInfo)

    console.info(
      'PaymentService#webhookPaymentSucceeded | Creating expense for absorbed fees',
    )
    const res = await intuitApi.createPurchase(parsedPayload)
    console.info(
      'PaymentService#webhookPaymentSucceeded | Created expense for absorbed fees with purchase Id =',
      res.Purchase?.Id,
    )
  }
}
