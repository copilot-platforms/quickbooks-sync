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
  eventType: z.string(),
  data: z.object({
    id: z.string(),
    lineItems: z.array(InvoiceLineItemSchema),
    number: z.string(),
    recipientId: z.string(),
    status: z.nativeEnum(InvoiceStatus),
    total: z.number(),
    taxAmount: z.number().optional(),
    sentDate: z.string().datetime().nullish(),
    dueDate: z.string().datetime().nullish(),
  }),
})

export type InvoiceCreatedResponseType = z.infer<
  typeof InvoiceCreatedResponseSchema
>

/** Product */
export const ProductCreatedResponseSchema = z.object({
  eventType: z.string(),
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
  eventType: z.string(),
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
  eventType: z.string(),
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

export const InvoicePaidResponseSchema = z.object({
  eventType: z.string(),
  data: z.object({
    id: z.string(),
    number: z.string(),
    status: z.nativeEnum(InvoiceStatus),
    total: z.number(),
  }),
})
export type InvoicePaidResponseType = z.infer<typeof InvoicePaidResponseSchema>

export const PaymentSucceededResponseSchema = z.object({
  eventType: z.string(),
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
  }),
})
export type PaymentSucceededResponseType = z.infer<
  typeof PaymentSucceededResponseSchema
>
