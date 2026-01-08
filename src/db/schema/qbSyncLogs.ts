import {
  FailedRecordCategoryType,
  EntityType,
  EventType,
  LogStatus,
} from '@/app/api/core/types/log'
import { timestamps } from '@/db/helper/column.helper'
import { enumToPgEnum } from '@/db/helper/drizzle.helper'
import { pgTable as table } from 'drizzle-orm/pg-core'
import * as t from 'drizzle-orm/pg-core'
import { createInsertSchema, createSelectSchema } from 'drizzle-zod'
import { z } from 'zod'

// Drizzle note: need to export these enums for drizzle-zod to generate enum types
export const EntityTypeEnum = t.pgEnum('entity_types', enumToPgEnum(EntityType))
export const StatusEnum = t.pgEnum('log_statuses', enumToPgEnum(LogStatus))
export const EventTypeEnum = t.pgEnum('event_types', enumToPgEnum(EventType))
export const FailedCategoryEnum = t.pgEnum(
  'failed_record_category_types',
  enumToPgEnum(FailedRecordCategoryType),
)

export const QBSyncLog = table('qb_sync_logs', {
  id: t.uuid().defaultRandom().primaryKey(),
  portalId: t.varchar('portal_id', { length: 255 }).notNull(),
  entityType: EntityTypeEnum('entity_type')
    .default(EntityType.INVOICE)
    .notNull(),
  eventType: EventTypeEnum('event_type').default(EventType.CREATED).notNull(),
  status: StatusEnum('status').default(LogStatus.SUCCESS).notNull(),
  syncAt: t.timestamp('sync_at'),
  copilotId: t.varchar('copilot_id', { length: 100 }).notNull(),
  quickbooksId: t.varchar('quickbooks_id', { length: 100 }),
  invoiceNumber: t.varchar('invoice_number', { length: 100 }),
  amount: t.decimal('amount'),
  remark: t.varchar('remark', { length: 255 }),
  customerName: t.varchar('customer_name', { length: 100 }),
  customerEmail: t.varchar('customer_email', { length: 100 }),
  taxAmount: t.decimal('tax_amount'),
  feeAmount: t.decimal('fee_amount'),
  productName: t.varchar('product_name', { length: 100 }),
  productPrice: t.decimal('product_price'),
  qbItemName: t.varchar('qb_item_name', { length: 100 }),
  copilotPriceId: t.varchar('copilot_price_id', { length: 100 }),
  errorMessage: t.text('error_message'),
  category: FailedCategoryEnum('category')
    .default(FailedRecordCategoryType.OTHERS)
    .notNull(),
  attempt: t.integer('attempt').default(0).notNull(),
  ...timestamps,
})

export const QBSyncLogCreateSchema = createInsertSchema(QBSyncLog)
export type QBSyncLogCreateSchemaType = z.infer<typeof QBSyncLogCreateSchema>

export type QBSyncLogWithEntityType = Omit<
  QBSyncLogCreateSchemaType,
  'entityType'
> & {
  entityType: EntityType
  eventType: EventType
}

export const QBSyncLogSelectSchema = createSelectSchema(QBSyncLog)
export type QBSyncLogSelectSchemaType = z.infer<typeof QBSyncLogSelectSchema>

export const QBSyncLogUpdateSchema = QBSyncLogCreateSchema.omit({
  createdAt: true,
}).partial()
export type QBSyncLogUpdateSchemaType = z.infer<typeof QBSyncLogUpdateSchema>
