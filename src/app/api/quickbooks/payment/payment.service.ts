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
import { QBPaymentCreatePayloadType } from '@/type/dto/intuitAPI.dto'
import IntuitAPI from '@/utils/intuitAPI'

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
}
