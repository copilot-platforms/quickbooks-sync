import { EntityType, EventType, LogStatus } from '@/app/api/core/types/log'
import { timestamps } from '@/db/helper/column.helper'
import { enumToPgEnum } from '@/db/helper/drizzle.helper'
import { pgTable as table } from 'drizzle-orm/pg-core'
import * as t from 'drizzle-orm/pg-core'
import { createInsertSchema, createSelectSchema } from 'drizzle-zod'
import { z } from 'zod'

const { deletedAt, ...newTimestamps } = timestamps

// Drizzle note: need to export these enums for drizzle-zod to generate enum types
export const EntityTypeEnum = t.pgEnum('entity_types', enumToPgEnum(EntityType))
export const StatusEnum = t.pgEnum('log_statuses', enumToPgEnum(LogStatus))
export const EventTypeEnum = t.pgEnum('event_types', enumToPgEnum(EventType))

export const QBSyncLog = table('qb_sync_logs', {
  id: t.uuid().defaultRandom().primaryKey(),
  portalId: t.varchar('portal_id', { length: 255 }).notNull(),
  entityType: EntityTypeEnum('entity_type')
    .default(EntityType.INVOICE)
    .notNull(),
  eventType: EventTypeEnum('event_type').default(EventType.CREATED).notNull(),
  status: StatusEnum('status').default(LogStatus.SUCCESS).notNull(),
  syncDate: t.date('sync_date'),
  syncTime: t.time('sync_time'),
  copilotId: t.varchar('copilot_id', { length: 100 }).notNull(),
  quickbooksId: t.varchar('quickbooks_id', { length: 100 }),
  invoiceNumber: t.varchar('invoice_number', { length: 100 }),
  amount: t.decimal('amount'),
  remark: t.varchar('remark', { length: 255 }),
  ...newTimestamps,
})

export const QBSyncLogCreateSchema = createInsertSchema(QBSyncLog)
export type QBSyncLogCreateSchemaType = z.infer<typeof QBSyncLogCreateSchema>

export const QBSyncLogSelectSchema = createSelectSchema(QBSyncLog)
export type QBSyncLogSelectSchemaType = z.infer<typeof QBSyncLogSelectSchema>

export const QBSyncLogUpdateSchema = QBSyncLogCreateSchema.omit({
  createdAt: true,
}).partial()
export type QBSyncLogUpdateSchemaType = z.infer<typeof QBSyncLogUpdateSchema>
