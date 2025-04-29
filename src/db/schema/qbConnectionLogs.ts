import { timestamps } from '@/db/helper/column.helper'
import { pgTable as table } from 'drizzle-orm/pg-core'
import * as t from 'drizzle-orm/pg-core'
import { createInsertSchema, createSelectSchema } from 'drizzle-zod'
import { z } from 'zod'

export const ConnectionStatus = {
  PENDING: 'pending',
  SUCCESS: 'success',
  ERROR: 'error',
}

export type ConnectionStatusType = keyof typeof ConnectionStatus

export const connectionStatusEnum = t.pgEnum(
  'connection_statuses',
  ConnectionStatus,
)

export const QBConnectionLogs = table('qb_connection_logs', {
  id: t.integer().primaryKey().generatedAlwaysAsIdentity(),
  portalId: t.varchar('portal_id', { length: 255 }).notNull(),
  connectionStatus: connectionStatusEnum('connection_status')
    .default(ConnectionStatus.PENDING)
    .notNull(),
  ...timestamps,
})

export const QBConnectionLogCreateSchema = createInsertSchema(QBConnectionLogs)
export type QBConnectionLogCreateSchemaType = z.infer<
  typeof QBConnectionLogCreateSchema
>

export const QBConnectionLogSelectSchema = createSelectSchema(QBConnectionLogs)
export type QBConnectionLogSelectSchemaType = z.infer<
  typeof QBConnectionLogSelectSchema
>

export const QBConnectionLogUpdateSchema = QBConnectionLogCreateSchema.omit({
  createdAt: true,
}).partial()
export type QBConnectionLogUpdateSchemaType = z.infer<
  typeof QBConnectionLogUpdateSchema
>
