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

// Shared by the webhook and REST invoice payloads. Sub-fields are optional so
// a partial address doesn't throw on the REST .parse() paths.
export const AddressSchema = z.object({
  addressLine1: z.string().optional(),
  city: z.string().optional(),
  country: z.string().optional(),
  region: z.string().optional(),
  postalCode: z.string().optional(),
})

export const InvoiceCreatedResponseSchema = z.object({
  data: z.object({
    id: z.string(),
    lineItems: z.array(InvoiceLineItemSchema),
    number: z.string(),
    // recipientId: z.string(),
    clientId: z.string().uuid().or(z.literal('')), // allow uuid or empty string
    companyId: z.string().uuid().or(z.literal('')), // allow uuid or empty string
    status: z.nativeEnum(InvoiceStatus),
    total: z.number(),
    taxPercentage: z.number().default(0).nullable(),
    taxAmount: z.number().default(0).nullable(),
    sentDate: z.string().datetime().nullish(),
    dueDate: z.string().datetime().nullish(),
    address: AddressSchema.optional(),
    paymentMethodPreferences: z
      .array(
        z.object({
          type: z.string(),
          feePaidByClient: z.boolean(),
        }),
      )
      .optional(),
  }),
})

export type InvoiceCreatedResponseType = z.infer<
  typeof InvoiceCreatedResponseSchema
>

export const InvoiceDestructiveResponseSchema = z.object({
  id: z.string(),
  number: z.string(),
  total: z.number(),
  // recipientId: z.string(),
  clientId: z.string().uuid().or(z.literal('')), // allow uuid or empty string
  companyId: z.string().uuid().or(z.literal('')), // allow uuid or empty string
})
export type InvoiceDestructiveResponse = z.infer<
  typeof InvoiceDestructiveResponseSchema
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

export const InvoiceResponseSchema = z.object({
  data: z.object({
    id: z.string(),
    number: z.string(),
    status: z.nativeEnum(InvoiceStatus),
    total: z.number(),
    taxPercentage: z.number().default(0).nullable(),
    taxAmount: z.number().default(0).nullable(),
    // recipientId: z.string(),
    clientId: z.string().uuid().or(z.literal('')), // allow uuid or empty string
    companyId: z.string().uuid().or(z.literal('')), // allow uuid or empty string
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
    feeAmount: z
      .object({
        paidByPlatform: z.number(),
        paidByClient: z.number(),
      })
      .nullable(),
    createdAt: z.string().datetime(),
  }),
})
export type PaymentSucceededResponseType = z.infer<
  typeof PaymentSucceededResponseSchema
>
