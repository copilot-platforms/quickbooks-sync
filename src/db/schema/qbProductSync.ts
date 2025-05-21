import { timestamps } from '@/db/helper/column.helper'
import { pgTable as table } from 'drizzle-orm/pg-core'
import * as t from 'drizzle-orm/pg-core'
import { createInsertSchema, createSelectSchema } from 'drizzle-zod'
import { z } from 'zod'

export const QBProductSync = table('qb_product_sync', {
  id: t.uuid().defaultRandom().primaryKey(),
  portalId: t.varchar('portal_id', { length: 255 }).notNull(),
  productId: t.varchar('product_id').notNull(),
  priceId: t.varchar('price_id').notNull(),
  qbItemId: t.varchar('qb_item_id'),
  qbSyncToken: t.varchar('qb_sync_token', { length: 100 }),
  ...timestamps,
})

export const QBProductCreateSchema = createInsertSchema(QBProductSync)
export type QBProductCreateSchemaType = z.infer<typeof QBProductCreateSchema>

// ignored portalId in QBProductCreateArraySchema as it can be retrieved from token. This schema is used in POST API request
export const QBProductCreateArraySchema = z.array(
  QBProductCreateSchema.omit({ portalId: true }),
)
export type QBProductCreateArraySchemaType = z.infer<
  typeof QBProductCreateArraySchema
>

export const QBProductSelectSchema = createSelectSchema(QBProductSync)
export type QBProductSelectSchemaType = z.infer<typeof QBProductSelectSchema>

export const QBProductUpdateSchema = QBProductCreateSchema.omit({
  createdAt: true,
})
export type QBProductUpdateSchemaType = z.infer<typeof QBProductUpdateSchema>
