// Asserts each QB_*_COLUMNS constant stays a superset of its schema's
// required keys. Optional-field drops still pass — verify callers if you
// remove one.

import { describe, it, expect } from 'vitest'
import {
  QB_ACCOUNT_COLUMNS,
  QB_CUSTOMER_COLUMNS,
  QB_INVOICE_COLUMNS,
  QB_ITEM_COLUMNS,
} from '@/utils/intuitAPI'
import {
  CustomerQueryResponseSchema,
  QBAccountRowSchema,
  QBInvoiceRowSchema,
  QBItemRowSchema,
} from '@/type/dto/intuitAPI.dto'
import type { ZodTypeAny } from 'zod'

const requiredKeysOf = (shape: Record<string, ZodTypeAny>): string[] =>
  Object.entries(shape)
    .filter(([, s]) => !s.isOptional())
    .map(([k]) => k)

describe('QB_INVOICE_COLUMNS', () => {
  it('selects every column the invoice schema marks as required', () => {
    for (const key of requiredKeysOf(QBInvoiceRowSchema.shape)) {
      expect(QB_INVOICE_COLUMNS).toContain(key)
    }
  })

  it('does not list any column that the invoice schema does not define', () => {
    const schemaKeys = new Set(Object.keys(QBInvoiceRowSchema.shape))
    for (const col of QB_INVOICE_COLUMNS) {
      expect(schemaKeys.has(col)).toBe(true)
    }
  })
})

describe('QB_ITEM_COLUMNS', () => {
  it('selects every column the item schema marks as required', () => {
    for (const key of requiredKeysOf(QBItemRowSchema.shape)) {
      expect(QB_ITEM_COLUMNS).toContain(key)
    }
  })

  it('does not list any column that the item schema does not define', () => {
    const schemaKeys = new Set(Object.keys(QBItemRowSchema.shape))
    for (const col of QB_ITEM_COLUMNS) {
      expect(schemaKeys.has(col)).toBe(true)
    }
  })
})

describe('QB_CUSTOMER_COLUMNS', () => {
  it('selects every column the customer schema marks as required', () => {
    for (const key of requiredKeysOf(CustomerQueryResponseSchema.shape)) {
      expect(QB_CUSTOMER_COLUMNS).toContain(key)
    }
  })

  it('does not list any column that the customer schema does not define', () => {
    const schemaKeys = new Set(Object.keys(CustomerQueryResponseSchema.shape))
    for (const col of QB_CUSTOMER_COLUMNS) {
      expect(schemaKeys.has(col)).toBe(true)
    }
  })
})

describe('QB_ACCOUNT_COLUMNS', () => {
  it('selects every column the account schema marks as required', () => {
    for (const key of requiredKeysOf(QBAccountRowSchema.shape)) {
      expect(QB_ACCOUNT_COLUMNS).toContain(key)
    }
  })

  it('does not list any column that the account schema does not define', () => {
    const schemaKeys = new Set(Object.keys(QBAccountRowSchema.shape))
    for (const col of QB_ACCOUNT_COLUMNS) {
      expect(schemaKeys.has(col)).toBe(true)
    }
  })
})
