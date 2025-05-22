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
})

export type QBCustomerCreatePayloadType = z.infer<
  typeof QBCustomerCreatePayloadSchema
>

export type QBCustomerParseUpdatePayloadType =
  Partial<QBCustomerCreatePayloadType> & { Id: string; SyncToken: string }

export const QBItemCreatePayloadSchema = z.object({
  Name: z.string(),
  UnitPrice: z.number(),
  IncomeAccountRef: QBNameValueSchema.optional(),
  Type: z.nativeEnum(QBItemType),
  Taxable: z.boolean(),
  Description: z.string().optional(),
})

export type QBItemCreatePayloadType = z.infer<typeof QBItemCreatePayloadSchema>
