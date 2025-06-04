import { timestamps } from '@/db/helper/column.helper'
import { pgTable as table } from 'drizzle-orm/pg-core'
import * as t from 'drizzle-orm/pg-core'
import { createInsertSchema, createSelectSchema } from 'drizzle-zod'
import { z } from 'zod'

export const QBProductSync = table('qb_product_sync', {
  id: t.uuid().defaultRandom().primaryKey(),
  portalId: t.varchar('portal_id', { length: 255 }).notNull(),
  productId: t.uuid('product_id'),
  priceId: t.varchar('price_id'),
  name: t.varchar({ length: 100 }),
  description: t.varchar({ length: 255 }),
  unitPrice: t.decimal('unit_price'),
  qbItemId: t.varchar('qb_item_id'),
  qbSyncToken: t.varchar('qb_sync_token', { length: 100 }),
  isExcluded: t.boolean('is_excluded').default(false),
  ...timestamps,
})

export const QBProductCreateSchema = createInsertSchema(QBProductSync)
export type QBProductCreateSchemaType = z.infer<typeof QBProductCreateSchema>

// ignored portalId in QBProductCreateArraySchema as it can be retrieved from token. This schema is used in POST API request
export const QBProductCreateArraySchema = z.array(
  QBProductCreateSchema.omit({ portalId: true }).superRefine((val, ctx) => {
    if (!val.isExcluded) {
      if (!val.name) {
        ctx.addIssue({
          path: ['name'],
          code: z.ZodIssueCode.custom,
          message: 'name is required when isExcluded is false',
        })
      }
      if (!val.qbItemId) {
        ctx.addIssue({
          path: ['qbItemId'],
          code: z.ZodIssueCode.custom,
          message: 'qbItemId is required when isExcluded is false',
        })
      }
      if (!val.qbSyncToken) {
        ctx.addIssue({
          path: ['qbSyncToken'],
          code: z.ZodIssueCode.custom,
          message: 'qbSyncToken is required when isExcluded is false',
        })
      }
      if (!val.unitPrice) {
        ctx.addIssue({
          path: ['unitPrice'],
          code: z.ZodIssueCode.custom,
          message: 'unitPrice is required when isExcluded is false',
        })
      }
    }
  }),
)
export type QBProductCreateArraySchemaType = z.infer<
  typeof QBProductCreateArraySchema
>

export const QBProductSelectSchema = createSelectSchema(QBProductSync)
export type QBProductSelectSchemaType = z.infer<typeof QBProductSelectSchema>

export const QBProductUpdateSchema = QBProductCreateSchema.omit({
  createdAt: true,
}).partial()
export type QBProductUpdateSchemaType = z.infer<typeof QBProductUpdateSchema>

type NonNullableProps<T> = {
  [K in keyof T]: NonNullable<T[K]>
}
export type ProductMappingItemType = NonNullableProps<
  Required<
    Pick<
      QBProductCreateSchemaType,
      | 'name'
      | 'priceId'
      | 'productId'
      | 'unitPrice'
      | 'qbItemId'
      | 'qbSyncToken'
    >
  >
> & { isExcluded: boolean }
