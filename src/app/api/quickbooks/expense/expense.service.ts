import { BaseService } from '@/app/api/core/services/base.service'
import { buildReturningFields } from '@/db/helper/drizzle.helper'
import {
  QBExpenseCreateSchema,
  QBExpenseCreateSchemaType,
  QBExpenseSelectSchemaType,
  QBExpenseSync,
} from '@/db/schema/qbExpenseSync'

export class ExpenseService extends BaseService {
  /**
   * Fetch expense record via payment ID
   */
  async getQBExpenseByPaymentId(paymentId: string) {
    const query = this.db.query.QBExpenseSync.findFirst({
      where: (QBExpenseSync, { eq }) => eq(QBExpenseSync.paymentId, paymentId),
    })
    return await query
  }

  /**
   * Creates the expense map (absorbed fees)
   */
  async createQBExpense(
    payload: QBExpenseCreateSchemaType,
    returningFields?: (keyof typeof QBExpenseSync)[],
  ): Promise<Partial<QBExpenseSelectSchemaType> | undefined> {
    const parsedInsertPayload = QBExpenseCreateSchema.parse(payload)
    const query = this.db.insert(QBExpenseSync).values(parsedInsertPayload)

    const [product] =
      returningFields && returningFields.length > 0
        ? await query.returning(
            buildReturningFields(QBExpenseSync, returningFields),
          )
        : await query.returning()

    console.info('ExpenseService#createQBExpense | expense map complete')
    return product
  }
}
