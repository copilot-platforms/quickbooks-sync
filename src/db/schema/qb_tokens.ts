import { timestamps } from '@/db/helper/column.helper'
import { pgTable as table } from 'drizzle-orm/pg-core'
import * as t from 'drizzle-orm/pg-core'

export const qb_tokens = table(
  'qb_tokens',
  {
    id: t.integer().primaryKey().generatedAlwaysAsIdentity(),
    portal_id: t.varchar({ length: 255 }).notNull(),
    intuit_realm_id: t.varchar({ length: 255 }).notNull(),
    access_token: t.varchar().notNull(),
    refresh_token: t.varchar().notNull(),
    expires_in: t.integer().notNull(),
    sync_flag: t.boolean().default(false),
    ...timestamps,
  },
  (table) => [t.uniqueIndex('portal_idx').on(table.portal_id)],
)
