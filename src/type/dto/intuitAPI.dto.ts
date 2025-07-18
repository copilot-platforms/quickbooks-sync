import { QBItemType } from '@/app/api/core/types/product'
import { TransactionType } from '@/type/common'
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
  GivenName: z.string().optional(),
  FamilyName: z.string().optional(),
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
          TxnType: z.nativeEnum(TransactionType),
        }),
      ),
    }),
  ),
})

export type QBPaymentCreatePayloadType = z.infer<
  typeof QBPaymentCreatePayloadSchema
>

// Destructive actions -> delete, void
export const QBDestructiveInvoicePayloadSchema = z.object({
  Id: z.string(),
  SyncToken: z.string(),
})

export type QBDestructiveInvoicePayloadSchema = z.infer<
  typeof QBDestructiveInvoicePayloadSchema
>

export const QBAccountCreatePayloadSchema = z.object({
  Name: z.string(),
  AccountType: z.string(),
  AccountSubType: z.string().optional(),
  Active: z.boolean(),
  Classification: z.string(),
})

export type QBAccountCreatePayloadType = z.infer<
  typeof QBAccountCreatePayloadSchema
>

export const QBPurchaseCreatePayloadSchema = z.object({
  PaymentType: z.literal('Cash'),
  AccountRef: QBNameValueSchema,
  DocNumber: z.string(),
  TxnDate: z.string(),
  Line: z.array(
    z.object({
      DetailType: z.literal('AccountBasedExpenseLineDetail'),
      Amount: z.number(),
      AccountBasedExpenseLineDetail: z.object({
        AccountRef: QBNameValueSchema,
      }),
    }),
  ),
})

export type QBPurchaseCreatePayloadType = z.infer<
  typeof QBPurchaseCreatePayloadSchema
>

export const QBDeletePayloadSchema = z.object({
  SyncToken: z.string(),
  Id: z.string(),
})

export type QBDeletePayloadType = z.infer<typeof QBDeletePayloadSchema>
