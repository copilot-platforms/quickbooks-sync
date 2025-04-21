import { timestamps } from '@/db/helper/column.helper'
import { pgTable as table } from 'drizzle-orm/pg-core'
import * as t from 'drizzle-orm/pg-core'

export const qb_product_sync = table('qb_product_sync', {
  id: t.integer().primaryKey().generatedAlwaysAsIdentity(),
  portalId: t.varchar('portal_id', { length: 255 }).notNull(),
  productId: t.varchar('product_id').notNull(),
  priceId: t.varchar('price_id').notNull(),
  qbItemId: t.varchar('qb_item_id'),
  ...timestamps,
})
