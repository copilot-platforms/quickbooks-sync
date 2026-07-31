import { PayoutLineItem } from '@/type/dto/webhook.dto'
import { timestamps } from '@/db/helper/column.helper'
import { isNull } from 'drizzle-orm'
import { pgTable as table } from 'drizzle-orm/pg-core'
import * as t from 'drizzle-orm/pg-core'
import { createInsertSchema, createSelectSchema } from 'drizzle-zod'
import { z } from 'zod'

export const QBPayoutSync = table(
  'qb_payout_sync',
  {
    id: t.uuid().defaultRandom().primaryKey(),
    portalId: t.varchar('portal_id', { length: 255 }).notNull(),
    // Copilot payout id. Same value we store as copilotId on the payout sync log.
    payoutId: t.varchar('payout_id', { length: 100 }).notNull(),
    // Small list we always read as a whole, so jsonb is fine (never query one item).
    lineItems: t.jsonb('line_items').$type<PayoutLineItem[]>().notNull(),
    // Cents, like line_items — the payout payload is in cents throughout.
    netAmount: t.integer('net_amount').notNull(),
    feeAmount: t.integer('fee_amount').notNull(),
    // Unix seconds, as delivered in the payout payload.
    arrivalDate: t.integer('arrival_date').notNull(),
    // Filled in once the QBO deposit is made. On resync we reuse it instead of
    // making another.
    qbDepositId: t.varchar('qb_deposit_id', { length: 100 }),
    ...timestamps,
  },
  (table) => [
    t
      .uniqueIndex('uq_qb_payout_sync_portal_payout_active')
      .on(table.portalId, table.payoutId)
      .where(isNull(table.deletedAt)),
  ],
)

export const QBPayoutSyncCreateSchema = createInsertSchema(QBPayoutSync)
export type QBPayoutSyncCreateSchemaType = z.infer<
  typeof QBPayoutSyncCreateSchema
>

export const QBPayoutSyncSelectSchema = createSelectSchema(QBPayoutSync)
export type QBPayoutSyncSelectSchemaType = z.infer<
  typeof QBPayoutSyncSelectSchema
>

export const QBPayoutSyncUpdateSchema = QBPayoutSyncCreateSchema.omit({
  createdAt: true,
}).partial()
export type QBPayoutSyncUpdateSchemaType = z.infer<
  typeof QBPayoutSyncUpdateSchema
>
