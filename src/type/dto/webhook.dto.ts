import { InvoiceStatus, PaymentStatus } from '@/app/api/core/types/invoice'
import { ProductStatus } from '@/app/api/core/types/product'
import { z } from 'zod'

export const WebhookEventResponseSchema = z.object({
  eventType: z.string(),
  created: z.string().optional(),
  object: z.string().optional(),
  data: z.unknown(),
})

export type WebhookEventResponseType = z.infer<
  typeof WebhookEventResponseSchema
>

/** Invoice */
export const InvoiceLineItemSchema = z.object({
  amount: z.number(),
  description: z.string(),
  priceId: z.string().optional(),
  productId: z.string().optional(),
  quantity: z.number(),
})

export type InvoiceLineItemSchemaType = z.infer<typeof InvoiceLineItemSchema>

export const InvoiceCreatedResponseSchema = z.object({
  data: z.object({
    id: z.string(),
    lineItems: z.array(InvoiceLineItemSchema),
    number: z.string(),
    recipientId: z.string(),
    status: z.nativeEnum(InvoiceStatus),
    total: z.number(),
    taxPercentage: z.number().default(0),
    sentDate: z.string().datetime().nullish(),
    dueDate: z.string().datetime().nullish(),
  }),
})

export type InvoiceCreatedResponseType = z.infer<
  typeof InvoiceCreatedResponseSchema
>

export const InvoiceDeletedResponseSchema = z.object({
  id: z.string(),
  number: z.string(),
  total: z.number(),
  recipientId: z.string(),
})
export type InvoiceDeletedResponse = z.infer<
  typeof InvoiceDeletedResponseSchema
>

/** Product */
export const ProductCreatedResponseSchema = z.object({
  data: z.object({
    id: z.string(),
    name: z.string(),
    status: z.nativeEnum(ProductStatus),
    description: z.string(),
  }),
})
export type ProductCreatedResponseType = z.infer<
  typeof ProductCreatedResponseSchema
>

export const ProductUpdatedResponseSchema = z.object({
  data: z.object({
    id: z.string(),
    name: z.string(),
    status: z.nativeEnum(ProductStatus),
    description: z.string(),
  }),
})
export type ProductUpdatedResponseType = z.infer<
  typeof ProductUpdatedResponseSchema
>

export const PriceCreatedResponseSchema = z.object({
  data: z.object({
    id: z.string(),
    productId: z.string(),
    amount: z.number(),
    type: z.string(),
  }),
})
export type PriceCreatedResponseType = z.infer<
  typeof PriceCreatedResponseSchema
>

export const InvoiceResponseSchema = z.object({
  data: z.object({
    id: z.string(),
    number: z.string(),
    status: z.nativeEnum(InvoiceStatus),
    total: z.number(),
    taxPercentage: z.number().default(0),
    recipientId: z.string(),
  }),
})
export type InvoiceResponseType = z.infer<typeof InvoiceResponseSchema>

export const PaymentSucceededResponseSchema = z.object({
  data: z.object({
    id: z.string(),
    invoiceId: z.string(),
    status: z.nativeEnum(PaymentStatus),
    paymentMethod: z.string(),
    brand: z.string(),
    feeAmount: z.object({
      paidByPlatform: z.number(),
      paidByClient: z.number(),
    }),
    createdAt: z.string().datetime(),
  }),
})
export type PaymentSucceededResponseType = z.infer<
  typeof PaymentSucceededResponseSchema
>
