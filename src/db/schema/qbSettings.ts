import { timestamps } from '@/db/helper/column.helper'
import { QBPortalConnection } from '@/db/schema/qbPortalConnections'
import { relations } from 'drizzle-orm'
import { pgTable as table } from 'drizzle-orm/pg-core'
import * as t from 'drizzle-orm/pg-core'
import { createInsertSchema, createSelectSchema } from 'drizzle-zod'
import { z } from 'zod'

const { deletedAt, ...newTimestamps } = timestamps

export const QBSetting = table('qb_settings', {
  id: t.uuid().defaultRandom().primaryKey(),
  portalId: t
    .varchar('portal_id', { length: 255 })
    .references(() => QBPortalConnection.portalId, { onDelete: 'cascade' })
    .notNull(),
  absorbedFeeFlag: t.boolean('absorbed_fee_flag').default(false).notNull(),
  useCompanyNameFlag: t.boolean('company_name_flag').default(false).notNull(),
  createNewProductFlag: t
    .boolean('create_new_product_flag')
    .default(false)
    .notNull(),
  initialInvoiceSettingMap: t
    .boolean('initial_invoice_setting_map')
    .default(false)
    .notNull(),
  initialProductSettingMap: t
    .boolean('initial_product_setting_map')
    .default(false)
    .notNull(),
  syncFlag: t.boolean('sync_flag').default(false).notNull(),
  isEnabled: t.boolean('is_enabled').default(false).notNull(),
  ...newTimestamps,
})

export const QBSettingRelations = relations(QBSetting, ({ one }) => ({
  portalConnection: one(QBPortalConnection, {
    fields: [QBSetting.portalId],
    references: [QBPortalConnection.portalId],
  }),
}))

export const QBSettingCreateSchema = createInsertSchema(QBSetting)
export type QBSettingCreateSchemaType = z.infer<typeof QBSettingCreateSchema>

export const QBSettingsSelectSchema = createSelectSchema(QBSetting)
export type QBSettingsSelectSchemaType = z.infer<typeof QBSettingsSelectSchema>

export const QBSettingsUpdateSchema = QBSettingCreateSchema.omit({
  createdAt: true,
}).partial()
export type QBSettingsUpdateSchemaType = z.infer<typeof QBSettingsUpdateSchema>
