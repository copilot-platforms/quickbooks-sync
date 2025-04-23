import { timestamps } from '@/db/helper/column.helper'
import { pgTable as table } from 'drizzle-orm/pg-core'
import * as t from 'drizzle-orm/pg-core'

export const QBInvoiceSync = table('qb_invoice_sync', {
  id: t.integer().primaryKey().generatedAlwaysAsIdentity(),
  portalId: t.varchar('portal_id', { length: 255 }).notNull(),
  invoiceNumber: t.varchar('invoice_number').notNull(),
  qbDocNumber: t.varchar('qb_doc_number').notNull(),
  qbInvoiceId: t.varchar('qb_invoice_id').notNull(),
  qbSyncToken: t.varchar('qb_sync_token', { length: 100 }).notNull(),
  ...timestamps,
})
