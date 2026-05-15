// Regression guard for QB_*_COLUMNS in src/utils/intuitAPI.ts. Asserting
// "constant ⊇ schema-required keys" catches drops that would ZodError at
// runtime. Optional-field drops are silent (callers just get undefined) —
// if you remove an optional column, verify every caller that reads it.

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
  it('includes every required field of QBInvoiceRowSchema', () => {
    for (const key of requiredKeysOf(QBInvoiceRowSchema.shape)) {
      expect(QB_INVOICE_COLUMNS).toContain(key)
    }
  })

  it('only references fields that exist on QBInvoiceRowSchema', () => {
    const schemaKeys = new Set(Object.keys(QBInvoiceRowSchema.shape))
    for (const col of QB_INVOICE_COLUMNS) {
      expect(schemaKeys.has(col)).toBe(true)
    }
  })
})

describe('QB_ITEM_COLUMNS', () => {
  it('includes every required field of QBItemRowSchema', () => {
    for (const key of requiredKeysOf(QBItemRowSchema.shape)) {
      expect(QB_ITEM_COLUMNS).toContain(key)
    }
  })

  it('only references fields that exist on QBItemRowSchema', () => {
    const schemaKeys = new Set(Object.keys(QBItemRowSchema.shape))
    for (const col of QB_ITEM_COLUMNS) {
      expect(schemaKeys.has(col)).toBe(true)
    }
  })
})

describe('QB_CUSTOMER_COLUMNS', () => {
  it('includes every required field of CustomerQueryResponseSchema', () => {
    for (const key of requiredKeysOf(CustomerQueryResponseSchema.shape)) {
      expect(QB_CUSTOMER_COLUMNS).toContain(key)
    }
  })

  it('only references fields that exist on CustomerQueryResponseSchema', () => {
    const schemaKeys = new Set(Object.keys(CustomerQueryResponseSchema.shape))
    for (const col of QB_CUSTOMER_COLUMNS) {
      expect(schemaKeys.has(col)).toBe(true)
    }
  })
})

describe('QB_ACCOUNT_COLUMNS', () => {
  it('includes every required field of QBAccountRowSchema', () => {
    for (const key of requiredKeysOf(QBAccountRowSchema.shape)) {
      expect(QB_ACCOUNT_COLUMNS).toContain(key)
    }
  })

  it('only references fields that exist on QBAccountRowSchema', () => {
    const schemaKeys = new Set(Object.keys(QBAccountRowSchema.shape))
    for (const col of QB_ACCOUNT_COLUMNS) {
      expect(schemaKeys.has(col)).toBe(true)
    }
  })
})
