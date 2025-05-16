import { BaseService } from '@/app/api/core/services/base.service'
import { buildReturningFields } from '@/db/helper/drizzle.helper'
import {
  QBCustomerCreateSchema,
  QBCustomerCreateSchemaType,
  QBCustomers,
  QBCustomerUpdateSchema,
  QBCustomerUpdateSchemaType,
} from '@/db/schema/qbCustomers'
import { and, isNull, SQL } from 'drizzle-orm'

type WhereClause = SQL<unknown>

export class CustomerService extends BaseService {
  async createQBCustomer(
    payload: QBCustomerCreateSchemaType,
    returningFields?: (keyof typeof QBCustomers)[],
  ) {
    console.log(
      'CustomerService#createQBCustomer | For client with Id =',
      payload.clientId,
    )
    const parsedInsertPayload = QBCustomerCreateSchema.parse(payload)
    const query = this.db.insert(QBCustomers).values(parsedInsertPayload)

    const [customer] =
      returningFields && returningFields.length > 0
        ? await query.returning(
            buildReturningFields(QBCustomers, returningFields),
          )
        : await query

    return customer
  }

  async updateQBCustomer(
    payload: QBCustomerUpdateSchemaType,
    conditions: WhereClause,
    returningFields?: (keyof typeof QBCustomers)[],
  ) {
    console.log('CustomerService#updateQBCustomer')
    const parsedInsertPayload = QBCustomerUpdateSchema.parse(payload)

    const query = this.db
      .update(QBCustomers)
      .set(parsedInsertPayload)
      .where(conditions)

    const [customer] =
      returningFields && returningFields.length > 0
        ? await query.returning(
            buildReturningFields(QBCustomers, returningFields),
          )
        : await query

    return customer
  }

  async getByClientId(
    clientId: string,
    returningFields?: (keyof typeof QBCustomers)[],
  ) {
    let columns = null
    if (returningFields && returningFields.length > 0) {
      columns = buildReturningFields(QBCustomers, returningFields, true)
    }

    return await this.db.query.QBCustomers.findFirst({
      where: (QBCustomers, { eq }) =>
        and(isNull(QBCustomers.deletedAt), eq(QBCustomers.clientId, clientId)),
      ...(columns && { columns }),
    })
  }
}
