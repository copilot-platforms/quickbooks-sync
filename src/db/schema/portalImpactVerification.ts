import { timestamps } from '@/db/helper/column.helper'
import { pgTable as table } from 'drizzle-orm/pg-core'
import * as t from 'drizzle-orm/pg-core'
import { createInsertSchema, createSelectSchema } from 'drizzle-zod'
import { z } from 'zod'

const { deletedAt, ...newTimestamps } = timestamps

export const PortalImpactVerification = table('portal_impact_verifications', {
  id: t.uuid().defaultRandom().primaryKey(),
  portalId: t.varchar('portal_id', { length: 32 }).unique().notNull(),
  isVerified: t.boolean('is_verified').default(false).notNull(),
  ...newTimestamps,
})

export const PortalImpactCreateSchema = createInsertSchema(
  PortalImpactVerification,
)
export type PortalImpactCreateSchemaType = z.infer<
  typeof PortalImpactCreateSchema
>

export const PortalImpactSelectSchema = createSelectSchema(
  PortalImpactVerification,
)
export type PortalImpactSelectSchemaType = z.infer<
  typeof PortalImpactSelectSchema
>
