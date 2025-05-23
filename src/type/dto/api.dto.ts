import { z } from 'zod'

export const ProductFlattenArrayResponseSchema = z.object({
  products: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      description: z.string().nullish(),
      priceId: z.string(),
      amount: z.number(),
      type: z.string(),
      interval: z.string().nullish(),
      currency: z.string(),
      createdAt: z.string().datetime(),
    }),
  ),
})
export type ProductFlattenArrayResponseType = z.infer<
  typeof ProductFlattenArrayResponseSchema
>
