import { QBItemType } from '@/app/api/core/types/product'
import { z } from 'zod'

export const QBNameValueSchema = z.object({
  name: z.string().optional(),
  value: z.string(),
})
export type QBNameValueSchemaType = z.infer<typeof QBNameValueSchema>

export const QBInvoiceLineItemSchema = z.object({
  DetailType: z.string(),
  Amount: z.number(),
  SalesItemLineDetail: z.object({
    ItemRef: QBNameValueSchema,
    Qty: z.number().optional(),
    UnitPrice: z.number().optional(),
  }),
  Description: z.string().optional(),
})
export type QBInvoiceLineItemSchemaType = z.infer<
  typeof QBInvoiceLineItemSchema
>

export const QBInvoiceCreatePayloadSchema = z.object({
  Line: z.array(QBInvoiceLineItemSchema),
  CustomerRef: z.object({
    value: z.string(),
  }),
})

export type QBInvoiceCreatePayloadType = z.infer<
  typeof QBInvoiceCreatePayloadSchema
>

export const QBInvoiceSparseUpdatePayloadSchema = z.object({
  Id: z.string(),
  sparse: z.literal(true),
  SyncToken: z.string(),
  TxnTaxDetail: z
    .object({
      TotalTax: z.number(),
    })
    .optional(),
  TxnDate: z.string().optional(),
  DueDate: z.string().optional(),
})

export type QBInvoiceSparseUpdatePayloadType = z.infer<
  typeof QBInvoiceSparseUpdatePayloadSchema
>

export const QBCustomerCreatePayloadSchema = z.object({
  GivenName: z.string(),
  FamilyName: z.string(),
  CompanyName: z.string().optional(),
  PrimaryEmailAddr: z.object({
    Address: z.string(),
  }),
  DisplayName: z.string().optional(),
  BillAddr: z.object({}).optional(),
})
export type QBCustomerCreatePayloadType = z.infer<
  typeof QBCustomerCreatePayloadSchema
>

export const QBCustomerSparseUpdatePayloadSchema =
  QBCustomerCreatePayloadSchema.partial().extend({
    Id: z.string(),
    SyncToken: z.string(),
    sparse: z.literal(true).default(true),
  })
export type QBCustomerSparseUpdatePayloadType = z.infer<
  typeof QBCustomerSparseUpdatePayloadSchema
>

export const QBItemCreatePayloadSchema = z.object({
  Name: z.string(),
  UnitPrice: z.number(),
  IncomeAccountRef: QBNameValueSchema.optional(),
  Type: z.nativeEnum(QBItemType),
  Taxable: z.boolean(),
  Description: z.string().optional(),
})
export type QBItemCreatePayloadType = z.infer<typeof QBItemCreatePayloadSchema>

export const QBItemFullUpdatePayloadSchema =
  QBItemCreatePayloadSchema.partial().extend({
    Id: z.string(),
    SyncToken: z.string(),
  })
export type QBItemFullUpdatePayloadType = z.infer<
  typeof QBItemFullUpdatePayloadSchema
>

export const QBPaymentCreatePayloadSchema = z.object({
  TotalAmt: z.number(),
  CustomerRef: z.object({
    value: z.string(),
  }),
  Line: z.array(
    z.object({
      Amount: z.number(),
      LinkedTxn: z.array(
        z.object({
          TxnId: z.string(),
          TxnType: z.string(),
        }),
      ),
    }),
  ),
})

export type QBPaymentCreatePayloadType = z.infer<
  typeof QBPaymentCreatePayloadSchema
>
