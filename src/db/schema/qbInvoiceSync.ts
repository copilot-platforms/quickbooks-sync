import { InvoiceStatus } from '@/app/api/core/types/invoice'
import { timestamps } from '@/db/helper/column.helper'
import { enumToPgEnum } from '@/db/helper/drizzle.helper'
import { QBCustomers } from '@/db/schema/qbCustomers'
import { relations } from 'drizzle-orm'
import { pgTable as table } from 'drizzle-orm/pg-core'
import * as t from 'drizzle-orm/pg-core'
import { createInsertSchema, createSelectSchema } from 'drizzle-zod'
import { z } from 'zod'

export const invoiceStatusEnum = t.pgEnum(
  'invoice_statuses',
  enumToPgEnum(InvoiceStatus),
)

export const QBInvoiceSync = table('qb_invoice_sync', {
  id: t.uuid().defaultRandom().primaryKey(),
  portalId: t.varchar('portal_id', { length: 255 }).notNull(),
  customerId: t.uuid('customer_id').references(() => QBCustomers.id, {
    onDelete: 'cascade',
    onUpdate: 'cascade',
  }),
  invoiceNumber: t.varchar('invoice_number').notNull(),
  qbInvoiceId: t.varchar('qb_invoice_id'),
  qbSyncToken: t.varchar('qb_sync_token', { length: 100 }),
  recipientId: t.uuid('recipient_id'),
  status: invoiceStatusEnum('status').default(InvoiceStatus.OPEN).notNull(),
  ...timestamps,
})

export const QBInvoiceSyncRelations = relations(QBInvoiceSync, ({ one }) => ({
  customer: one(QBCustomers, {
    fields: [QBInvoiceSync.customerId],
    references: [QBCustomers.id],
  }),
}))

export const QBInvoiceCreateSchema = createInsertSchema(QBInvoiceSync)
export type QBInvoiceCreateSchemaType = z.infer<typeof QBInvoiceCreateSchema>

export const QBInvoiceSelectSchema = createSelectSchema(QBInvoiceSync)
export type QBInvoiceSelectSchemaType = z.infer<typeof QBInvoiceSelectSchema>

export const QBInvoiceUpdateSchema = QBInvoiceCreateSchema.omit({
  createdAt: true,
}).partial()
export type QBInvoiceUpdateSchemaType = z.infer<typeof QBInvoiceUpdateSchema>
