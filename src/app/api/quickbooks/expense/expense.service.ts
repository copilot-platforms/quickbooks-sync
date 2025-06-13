import { BaseService } from '@/app/api/core/services/base.service'
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
  ): Promise<QBExpenseSelectSchemaType> {
    const parsedInsertPayload = QBExpenseCreateSchema.parse(payload)
    const [expense] = await this.db
      .insert(QBExpenseSync)
      .values(parsedInsertPayload)
      .returning()

    console.info('ExpenseService#createQBExpense | expense map complete')
    return expense
  }
}
