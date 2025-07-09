import { timestamps } from '@/db/helper/column.helper'
import { pgTable as table } from 'drizzle-orm/pg-core'
import * as t from 'drizzle-orm/pg-core'
import { createInsertSchema, createSelectSchema } from 'drizzle-zod'
import { z } from 'zod'

export const QBPaymentSync = table('qb_payment_sync', {
  id: t.uuid().defaultRandom().primaryKey(),
  portalId: t.varchar('portal_id', { length: 255 }).notNull(),
  invoiceNumber: t.varchar('invoice_number').notNull(),
  totalAmount: t.decimal('total_amount').notNull(),
  qbPaymentId: t.varchar('qb_payment_id').notNull(),
  qbSyncToken: t.varchar('qb_sync_token', { length: 100 }).notNull(),
  ...timestamps,
})

export const QBPaymentCreateSchema = createInsertSchema(QBPaymentSync)
export type QBPaymentCreateSchemaType = z.infer<typeof QBPaymentCreateSchema>

export const QBPaymentSelectSchema = createSelectSchema(QBPaymentSync)
export type QBPaymentSelectSchemaType = z.infer<typeof QBPaymentSelectSchema>

export const QBPaymentUpdateSchema = QBPaymentCreateSchema.omit({
  createdAt: true,
}).partial()
export type QBPaymentUpdateSchemaType = z.infer<typeof QBPaymentUpdateSchema>
