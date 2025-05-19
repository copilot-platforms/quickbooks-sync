import { z } from 'zod'

const QBInvoiceLineItemSchema = z.object({
  DetailType: z.string(),
  Amount: z.number(),
  SalesItemLineDetail: z.object({
    ItemRef: z.object({
      name: z.string().optional(),
      value: z.string(),
    }),
    Qty: z.number().optional(),
    UnitPrice: z.number().optional(),
  }),
  Description: z.string().optional(),
})

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
  sparse: z.boolean(),
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
