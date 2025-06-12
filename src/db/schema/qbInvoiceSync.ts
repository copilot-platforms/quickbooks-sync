import { InvoiceStatus } from '@/app/api/core/types/invoice'
import { timestamps } from '@/db/helper/column.helper'
import { pgTable as table } from 'drizzle-orm/pg-core'
import * as t from 'drizzle-orm/pg-core'
import { createInsertSchema, createSelectSchema } from 'drizzle-zod'
import { z } from 'zod'

export function enumToPgEnum<T extends Record<string, any>>(
  myEnum: T,
): [T[keyof T], ...T[keyof T][]] {
  return Object.values(myEnum).map((value: any) => `${value}`) as any
}

const invoiceStatusEnum = t.pgEnum(
  'invoice_statuses',
  enumToPgEnum(InvoiceStatus),
)

export const QBInvoiceSync = table('qb_invoice_sync', {
  id: t.uuid().defaultRandom().primaryKey(),
  portalId: t.varchar('portal_id', { length: 255 }).notNull(),
  invoiceNumber: t.varchar('invoice_number').notNull(),
  qbInvoiceId: t.varchar('qb_invoice_id'),
  qbSyncToken: t.varchar('qb_sync_token', { length: 100 }),
  clientId: t.uuid('client_id'),
  status: invoiceStatusEnum('status').default(InvoiceStatus.OPEN).notNull(),
  ...timestamps,
})

export const QBInvoiceCreateSchema = createInsertSchema(QBInvoiceSync)
export type QBInvoiceCreateSchemaType = z.infer<typeof QBInvoiceCreateSchema>

export const QBInvoiceSelectSchema = createSelectSchema(QBInvoiceSync)
export type QBInvoiceSelectSchemaType = z.infer<typeof QBInvoiceSelectSchema>

export const QBInvoiceUpdateSchema = QBInvoiceCreateSchema.omit({
  createdAt: true,
}).partial()
export type QBInvoiceUpdateSchemaType = z.infer<typeof QBInvoiceUpdateSchema>
