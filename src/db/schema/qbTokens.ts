import { timestamps } from '@/db/helper/column.helper'
import { pgTable as table } from 'drizzle-orm/pg-core'
import { createInsertSchema, createSelectSchema } from 'drizzle-zod'
import * as t from 'drizzle-orm/pg-core'
import { z } from 'zod'

export const QBTokens = table(
  'qb_tokens',
  {
    id: t.uuid().defaultRandom().primaryKey(),
    portalId: t.varchar('portal_id', { length: 255 }).notNull(),
    intuitRealmId: t.varchar('intuit_realm_id', { length: 255 }).notNull(),
    accessToken: t.varchar('access_token').notNull(),
    refreshToken: t.varchar('refresh_token').notNull(),
    expiresIn: t.integer('expires_in').notNull(),
    XRefreshTokenExpiresIn: t.integer('x_refresh_token_expires_in').notNull(),
    syncFlag: t.boolean('sync_flag').default(false).notNull(),
    tokenType: t.varchar('token_type', { length: 255 }),
    tokenSetTime: t.timestamp('token_set_time'),
    intiatedBy: t.varchar('intiated_by', { length: 255 }).notNull(),
    incomeAccountRef: t
      .varchar('income_account_ref', { length: 100 })
      .notNull(),
    assetAccountRef: t.varchar('asset_account_ref', { length: 100 }).notNull(),
    expenseAccountRef: t
      .varchar('expense_account_ref', { length: 100 })
      .notNull(),
    isEnabled: t.boolean('is_enabled').default(false),
    ...timestamps,
  },
  (table) => [t.uniqueIndex('uq_qb_tokens_portal_id_idx').on(table.portalId)],
)

export const QBTokenCreateSchema = createInsertSchema(QBTokens)
export type QBTokenCreateSchemaType = z.infer<typeof QBTokenCreateSchema>

export const QBTokenSelectSchema = createSelectSchema(QBTokens)
export type QBTokenSelectSchemaType = z.infer<typeof QBTokenSelectSchema>

export const QBTokenUpdateSchema = QBTokenCreateSchema.omit({
  createdAt: true,
}).partial()
export type QBTokenUpdateSchemaType = z.infer<typeof QBTokenUpdateSchema>
