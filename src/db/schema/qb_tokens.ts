import { timestamps } from '@/db/helper/column.helper'
import { pgTable as table } from 'drizzle-orm/pg-core'
import * as t from 'drizzle-orm/pg-core'

export const qb_tokens = table(
  'qb_tokens',
  {
    id: t.integer().primaryKey().generatedAlwaysAsIdentity(),
    portalId: t.varchar('portal_id', { length: 255 }).notNull(),
    intuitRealmId: t.varchar('intuit_realm_id', { length: 255 }).notNull(),
    accessToken: t.varchar('access_token').notNull(),
    refreshToken: t.varchar('refresh_token').notNull(),
    expiresIn: t.integer('expires_in').notNull(),
    XRefreshTokenExpiresIn: t.integer('x_refresh_token_expires_in').notNull(),
    syncFlag: t.boolean('sync_flag').default(false),
    ...timestamps,
  },
  (table) => [t.uniqueIndex('uq_qb_tokens_portal_id_idx').on(table.portalId)],
)
