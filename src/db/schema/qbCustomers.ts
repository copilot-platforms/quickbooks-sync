import { timestamps } from '@/db/helper/column.helper'
import { pgTable as table } from 'drizzle-orm/pg-core'
import { createInsertSchema, createSelectSchema } from 'drizzle-zod'
import * as t from 'drizzle-orm/pg-core'
import { z } from 'zod'
import { relations } from 'drizzle-orm'
import { QBInvoiceSync } from '@/db/schema/qbInvoiceSync'

export const QBCustomers = table('qb_customers', {
  id: t.uuid().defaultRandom().primaryKey(),
  portalId: t.varchar('portal_id', { length: 255 }).notNull(),
  customerId: t.uuid('customer_id').notNull(), // can be copilot client Id or company Id
  clientCompanyId: t.varchar('client_company_id', { length: 255 }), // Copilot client company Id
  clientId: t.uuid('client_id'), // Copilot client Id
  companyId: t.uuid('company_id'), // Copilot company Id
  givenName: t.varchar('given_name', { length: 255 }),
  familyName: t.varchar('family_name', { length: 255 }),
  displayName: t.varchar('display_name', { length: 255 }),
  email: t.varchar('email', { length: 255 }),
  companyName: t.varchar('company_name', { length: 255 }),
  qbSyncToken: t.varchar('qb_sync_token', { length: 100 }).notNull(),
  qbCustomerId: t.varchar('qb_customer_id', { length: 100 }).notNull(),
  ...timestamps,
})

export const QBCustomerRelations = relations(QBCustomers, ({ many }) => ({
  invoices: many(QBInvoiceSync),
}))

export const QBCustomerCreateSchema = createInsertSchema(QBCustomers)
export type QBCustomerCreateSchemaType = z.infer<typeof QBCustomerCreateSchema>

export const QBCustomerSelectSchema = createSelectSchema(QBCustomers)
export type QBCustomerSelectSchemaType = z.infer<typeof QBCustomerSelectSchema>

export const QBCustomerUpdateSchema = QBCustomerCreateSchema.omit({
  createdAt: true,
}).partial()
export type QBCustomerUpdateSchemaType = z.infer<typeof QBCustomerUpdateSchema>
