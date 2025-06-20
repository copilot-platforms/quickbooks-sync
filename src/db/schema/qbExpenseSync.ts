import { timestamps } from '@/db/helper/column.helper'
import { pgTable as table } from 'drizzle-orm/pg-core'
import * as t from 'drizzle-orm/pg-core'
import { createInsertSchema, createSelectSchema } from 'drizzle-zod'
import { z } from 'zod'

const { deletedAt, ...newTimestamps } = timestamps

export const QBExpenseSync = table('qb_expense_sync', {
  id: t.uuid().defaultRandom().primaryKey(),
  portalId: t.varchar('portal_id', { length: 255 }).notNull(),
  paymentId: t.varchar('payment_id').notNull(),
  invoiceId: t.varchar('invoice_id').notNull(),
  invoiceNumber: t.varchar('invoice_number'),
  qbPurchaseId: t.varchar('qb_purchase_id'),
  qbSyncToken: t.varchar('qb_sync_token', { length: 100 }),
  ...newTimestamps,
})

export const QBExpenseCreateSchema = createInsertSchema(QBExpenseSync)
export type QBExpenseCreateSchemaType = z.infer<typeof QBExpenseCreateSchema>

export const QBExpenseSelectSchema = createSelectSchema(QBExpenseSync)
export type QBExpenseSelectSchemaType = z.infer<typeof QBExpenseSelectSchema>
