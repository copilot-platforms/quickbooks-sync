import { InvoiceStatus } from '@/app/api/core/types/invoice'
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
  }),
})

export type InvoiceCreatedResponseType = z.infer<
  typeof InvoiceCreatedResponseSchema
>
