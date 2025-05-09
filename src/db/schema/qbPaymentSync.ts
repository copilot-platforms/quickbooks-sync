import { timestamps } from '@/db/helper/column.helper'
import { pgTable as table } from 'drizzle-orm/pg-core'
import * as t from 'drizzle-orm/pg-core'

export const QBPaymentSync = table('qb_payment_sync', {
  id: t.integer().primaryKey().generatedAlwaysAsIdentity(),
  portalId: t.varchar('portal_id', { length: 255 }).notNull(),
  paymentId: t.integer('payment_id').notNull(),
  invoiceNumber: t.varchar('invoice_number').notNull(),
  qbPaymentId: t.varchar('qb_payment_id').notNull(),
  ...timestamps,
})
