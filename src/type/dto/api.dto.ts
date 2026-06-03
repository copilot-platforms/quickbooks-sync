import { z } from 'zod'

export const ProductFlattenResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullish(),
})
export type ProductFlattenResponseType = z.infer<
  typeof ProductFlattenResponseSchema
>

export const ProductFlattenArrayResponseSchema = z.object({
  products: z.array(ProductFlattenResponseSchema),
})
export type ProductFlattenArrayResponseType = z.infer<
  typeof ProductFlattenArrayResponseSchema
>
