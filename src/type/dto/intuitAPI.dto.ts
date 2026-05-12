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
    Active: z.boolean().optional(),
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
    sparse: z.boolean().optional(),
    Active: z.boolean().optional(),
  })
export type QBItemFullUpdatePayloadType = z.infer<
  typeof QBItemFullUpdatePayloadSchema
>

export const QBItemRowSchema = z
  .object({
    Id: z.string(),
    SyncToken: z.string(),
    Name: z.string(),
    ClassRef: QBNameValueSchema.optional(),
    Active: z.boolean(),
    UnitPrice: z.number(),
  })
  .passthrough()
export type QBItemRowType = z.infer<typeof QBItemRowSchema>

export const QBItemResponseSchema = z.object({
  Item: QBItemRowSchema,
})
export type QBItemResponseType = z.infer<typeof QBItemResponseSchema>

// Envelope returned by `customQuery` for `SELECT ... FROM Item`. Item is
// optional because QBO omits the key when there are zero results.
export const QBItemQueryResponseSchema = z.object({
  Item: z.array(QBItemRowSchema).optional(),
})
export type QBItemQueryResponseType = z.infer<typeof QBItemQueryResponseSchema>

export const QBPaymentCreatePayloadSchema = z.object({
  TotalAmt: z.number(),
  CustomerRef: z.object({
    value: z.string(),
  }),
  DepositToAccountRef: z
    .object({
      value: z.string(),
    })
    .optional(),
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

export const QBAccountUpdatePayloadSchema =
  QBAccountCreatePayloadSchema.partial().extend({
    Id: z.string(),
    Name: z.string(),
    SyncToken: z.string(),
    sparse: z.boolean().optional(),
    Active: z.boolean().optional(),
  })
export type QBAccountUpdatePayloadType = z.infer<
  typeof QBAccountUpdatePayloadSchema
>

export const QBAccountRowSchema = z
  .object({
    Id: z.string(),
    Name: z.string(),
    SyncToken: z.string(),
    Active: z.boolean(),
  })
  .passthrough()
export type QBAccountRowType = z.infer<typeof QBAccountRowSchema>

export const QBAccountResponseSchema = z.object({
  Account: QBAccountRowSchema,
})
export type QBAccountResponseType = z.infer<typeof QBAccountResponseSchema>

export const QBAccountQueryResponseSchema = z.object({
  Account: z.array(QBAccountRowSchema).optional(),
})
export type QBAccountQueryResponseType = z.infer<
  typeof QBAccountQueryResponseSchema
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

export const QBDepositLineSchema = z.union([
  z.object({
    Amount: z.number(),
    LinkedTxn: z.array(
      z.object({
        TxnId: z.string(),
        TxnType: z.literal('Payment'),
        TxnLineId: z.string(),
      }),
    ),
  }),
  z.object({
    Amount: z.number(),
    DetailType: z.literal('DepositLineDetail'),
    DepositLineDetail: z.object({
      AccountRef: QBNameValueSchema,
    }),
    Description: z.string().optional(),
  }),
])

export const QBDepositCreatePayloadSchema = z.object({
  DepositToAccountRef: z.object({
    value: z.string(),
  }),
  PrivateNote: z.string().optional(),
  TxnDate: z.string(),
  Line: z.array(QBDepositLineSchema),
})

export type QBDepositCreatePayloadType = z.infer<
  typeof QBDepositCreatePayloadSchema
>

export const QBDeletePayloadSchema = z.object({
  SyncToken: z.string(),
  Id: z.string(),
})

export type QBDeletePayloadType = z.infer<typeof QBDeletePayloadSchema>

export const CompanyInfoSchema = z.object({
  CompanyInfo: z.array(
    z.object({
      Country: z.string(),
    }),
  ),
})
export type CompanyInfoType = z.infer<typeof CompanyInfoSchema>

export const CustomerQueryResponseSchema = z
  .object({
    Id: z.string(),
    SyncToken: z.string(),
    Active: z.boolean(),
    CompanyName: z.string().optional(),
    FullyQualifiedName: z.string().optional(),
    PrimaryEmailAddr: z
      .object({
        Address: z.string(),
      })
      .optional(),
  })
  .passthrough()

export type CustomerQueryResponseType = z.infer<
  typeof CustomerQueryResponseSchema
>

// Envelope row used for the paginated email walk. PrimaryEmailAddr.Address is
// `unknown` (not `z.string()`) because mid-walk we tolerate QBO returning
// malformed rows (null/number/missing Address) without failing the whole page;
// the find() predicate narrows with `typeof addr === 'string'`.
export const CustomerListRowSchema = z
  .object({
    Id: z.string(),
    SyncToken: z.string(),
    Active: z.boolean(),
    CompanyName: z.string().optional(),
    FullyQualifiedName: z.string().optional(),
    PrimaryEmailAddr: z
      .object({
        Address: z.unknown(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough()
export type CustomerListRowType = z.infer<typeof CustomerListRowSchema>

export const CustomerListEnvelopeSchema = z.object({
  Customer: z.array(CustomerListRowSchema).optional(),
})
export type CustomerListEnvelopeType = z.infer<
  typeof CustomerListEnvelopeSchema
>

export const QBInvoiceRowSchema = z
  .object({
    Id: z.string(),
    SyncToken: z.string(),
    DocNumber: z.string().optional(),
    Balance: z.number().optional(),
    TotalAmt: z.number().optional(),
    TxnDate: z.string().optional(),
    DueDate: z.string().optional(),
    PrivateNote: z.string().optional(),
    CustomerRef: QBNameValueSchema.optional(),
  })
  .passthrough()
export type QBInvoiceRowType = z.infer<typeof QBInvoiceRowSchema>

// Envelope returned by createInvoice / invoiceSparseUpdate / voidInvoice.
export const QBInvoiceResponseSchema = z.object({
  Invoice: QBInvoiceRowSchema,
  time: z.string().optional(),
})
export type QBInvoiceResponseType = z.infer<typeof QBInvoiceResponseSchema>

// Envelope returned by customQuery for SELECT ... FROM Invoice. Invoice is
// optional because QBO omits the key when there are zero results.
export const QBInvoiceQueryResponseSchema = z.object({
  Invoice: z.array(QBInvoiceRowSchema).optional(),
})
export type QBInvoiceQueryResponseType = z.infer<
  typeof QBInvoiceQueryResponseSchema
>

// Envelope returned by deleteInvoice (no full row, just deletion confirmation).
export const QBInvoiceDeleteResponseSchema = z.object({
  Invoice: z.object({
    Id: z.string(),
    status: z.string().optional(),
    domain: z.string().optional(),
  }),
  time: z.string().optional(),
})
export type QBInvoiceDeleteResponseType = z.infer<
  typeof QBInvoiceDeleteResponseSchema
>

export const QBPurchaseRowSchema = z
  .object({
    Id: z.string(),
    SyncToken: z.string(),
    TotalAmt: z.number(),
    TxnDate: z.string().optional(),
    AccountRef: QBNameValueSchema.optional(),
    PaymentType: z.string().optional(),
  })
  .passthrough()
export type QBPurchaseRowType = z.infer<typeof QBPurchaseRowSchema>

export const QBPurchaseResponseSchema = z.object({
  Purchase: QBPurchaseRowSchema,
  time: z.string().optional(),
})
export type QBPurchaseResponseType = z.infer<typeof QBPurchaseResponseSchema>

export const QBPurchaseDeleteResponseSchema = z.object({
  Purchase: z.object({
    Id: z.string(),
    status: z.string().optional(),
    domain: z.string().optional(),
  }),
  time: z.string().optional(),
})
export type QBPurchaseDeleteResponseType = z.infer<
  typeof QBPurchaseDeleteResponseSchema
>

export const QBPaymentRowSchema = z
  .object({
    Id: z.string(),
    SyncToken: z.string().optional(),
    TotalAmt: z.number(),
    TxnDate: z.string().optional(),
    CustomerRef: QBNameValueSchema.optional(),
    Line: z
      .array(
        z.object({
          Amount: z.number().optional(),
          LinkedTxn: z
            .array(
              z.object({
                TxnId: z.string(),
                TxnType: z.string(),
              }),
            )
            .optional(),
        }),
      )
      .optional(),
  })
  .passthrough()
export type QBPaymentRowType = z.infer<typeof QBPaymentRowSchema>

export const QBPaymentResponseSchema = z.object({
  Payment: QBPaymentRowSchema,
  time: z.string().optional(),
})
export type QBPaymentResponseType = z.infer<typeof QBPaymentResponseSchema>

export const QBPaymentDeleteResponseSchema = z.object({
  Payment: z.object({
    Id: z.string(),
    status: z.string().optional(),
    domain: z.string().optional(),
  }),
  time: z.string().optional(),
})
export type QBPaymentDeleteResponseType = z.infer<
  typeof QBPaymentDeleteResponseSchema
>

export const QBItemsResponseSchema = z.array(
  z.object({
    Id: z.string(),
    Name: z.string(),
    UnitPrice: z.number(),
    Description: z.string().nullish(),
    SyncToken: z.string(),
  }),
)
export type QBItemsResponseType = z.infer<typeof QBItemsResponseSchema>

export const SingleIdAndTokenResponseSchema = z.object({
  Id: z.string(),
  SyncToken: z.string(),
})
export type SingleIdAndTokenResponseType = z.infer<
  typeof SingleIdAndTokenResponseSchema
>
