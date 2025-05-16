import { timestamps } from '@/db/helper/column.helper'
import { pgTable as table } from 'drizzle-orm/pg-core'
import { createInsertSchema, createSelectSchema } from 'drizzle-zod'
import * as t from 'drizzle-orm/pg-core'
import { z } from 'zod'

export const QBCustomers = table('qb_customers', {
  id: t.uuid().defaultRandom().primaryKey(),
  portalId: t.varchar('portal_id', { length: 255 }).notNull(),
  clientId: t.uuid('client_id').notNull(),
  givenName: t.varchar('given_name', { length: 255 }),
  familyName: t.varchar('family_name', { length: 255 }),
  email: t.varchar('email', { length: 255 }),
  companyName: t.varchar('company_name', { length: 255 }),
  qbSyncToken: t.varchar('qb_sync_token', { length: 100 }).notNull(),
  qbCustomerId: t.varchar('qb_customer_id', { length: 100 }).notNull(),
  ...timestamps,
})

export const QBCustomerCreateSchema = createInsertSchema(QBCustomers)
export type QBCustomerCreateSchemaType = z.infer<typeof QBCustomerCreateSchema>

export const QBCustomerSelectSchema = createSelectSchema(QBCustomers)
export type QBCustomerSelectSchemaType = z.infer<typeof QBCustomerSelectSchema>

export const QBCustomerUpdateSchema = QBCustomerCreateSchema.omit({
  createdAt: true,
}).partial()
export type QBCustomerUpdateSchemaType = z.infer<typeof QBCustomerUpdateSchema>
