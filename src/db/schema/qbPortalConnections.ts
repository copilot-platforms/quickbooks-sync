import { timestamps } from '@/db/helper/column.helper'
import { pgTable as table } from 'drizzle-orm/pg-core'
import { createInsertSchema, createSelectSchema } from 'drizzle-zod'
import * as t from 'drizzle-orm/pg-core'
import { z } from 'zod'
import { relations } from 'drizzle-orm'
import { QBSetting, QBSettingsSelectSchemaType } from '@/db/schema/qbSettings'

export const QBPortalConnection = table(
  'qb_portal_connections',
  {
    id: t.uuid().defaultRandom().primaryKey(),
    portalId: t.varchar('portal_id', { length: 255 }).notNull(),
    intuitRealmId: t.varchar('intuit_realm_id', { length: 255 }).notNull(),
    accessToken: t.varchar('access_token').notNull(),
    refreshToken: t.varchar('refresh_token').notNull(),
    expiresIn: t.integer('expires_in').notNull(),
    XRefreshTokenExpiresIn: t.integer('x_refresh_token_expires_in').notNull(),
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
    ...timestamps,
  },
  (table) => [
    t.uniqueIndex('uq_qb_portal_connections_portal_id_idx').on(table.portalId),
  ],
)

export const QBPortalConnectionRelations = relations(
  QBPortalConnection,
  ({ one }) => ({
    setting: one(QBSetting),
  }),
)

export const QBPortalConnectionCreateSchema =
  createInsertSchema(QBPortalConnection)
export type QBPortalConnectionCreateSchemaType = z.infer<
  typeof QBPortalConnectionCreateSchema
>

export const QBPortalConnectionSelectSchema =
  createSelectSchema(QBPortalConnection)
export type QBPortalConnectionSelectSchemaType = z.infer<
  typeof QBPortalConnectionSelectSchema
>

export type PortalConnectionWithSettingType = {
  setting: QBSettingsSelectSchemaType | null
} & QBPortalConnectionSelectSchemaType

export const QBPortalConnectionUpdateSchema =
  QBPortalConnectionCreateSchema.omit({
    createdAt: true,
  }).partial()
export type QBPortalConnectionUpdateSchemaType = z.infer<
  typeof QBPortalConnectionUpdateSchema
>
