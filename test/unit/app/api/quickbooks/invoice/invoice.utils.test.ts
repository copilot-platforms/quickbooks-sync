import { describe, expect, it } from 'vitest'
import {
  findNextAvailableDocNumber,
  formatAssemblyInvoicePrivateNote,
} from '@/app/api/quickbooks/invoice/invoice.utils'

describe('formatAssemblyInvoicePrivateNote', () => {
  it('formats an invoice number into the canonical PrivateNote string', () => {
    expect(formatAssemblyInvoicePrivateNote('MFBZU6WM-00002')).toBe(
      'Assembly invoice: MFBZU6WM-00002',
    )
  })

  it('passes through arbitrary alphanumerics with hyphens unchanged', () => {
    expect(formatAssemblyInvoicePrivateNote('ABC-12345')).toBe(
      'Assembly invoice: ABC-12345',
    )
  })
})

describe('findNextAvailableDocNumber', () => {
  it('returns the base DocNumber when no collisions exist', () => {
    const taken = new Set<string>()
    expect(findNextAvailableDocNumber('MFBZU6WM-00002', taken)).toBe(
      'MFBZU6WM-00002',
    )
  })

  it('returns -1 when the base is taken', () => {
    const taken = new Set(['MFBZU6WM-00002'])
    expect(findNextAvailableDocNumber('MFBZU6WM-00002', taken)).toBe(
      'MFBZU6WM-00002-1',
    )
  })

  it('walks past taken suffixes to the next free slot', () => {
    const taken = new Set([
      'MFBZU6WM-00002',
      'MFBZU6WM-00002-1',
      'MFBZU6WM-00002-2',
    ])
    expect(findNextAvailableDocNumber('MFBZU6WM-00002', taken)).toBe(
      'MFBZU6WM-00002-3',
    )
  })

  it('ignores unrelated DocNumbers that happen to share the prefix', () => {
    const taken = new Set([
      'MFBZU6WM-00002SOMETHING',
      'MFBZU6WM-00002-1-EXTRA',
    ])
    expect(findNextAvailableDocNumber('MFBZU6WM-00002', taken)).toBe(
      'MFBZU6WM-00002',
    )
  })

  it('throws when no suffix fits within the 21-char DocNumber limit', () => {
    const longBase = 'ABCDEFGHIJKLMNOPQRST'
    const taken = new Set([longBase])
    expect(() => findNextAvailableDocNumber(longBase, taken)).toThrow(
      /exceeds 21/,
    )
  })

  it('throws when the base itself exceeds 21 chars and is not taken', () => {
    const longBase = 'A'.repeat(22)
    expect(() => findNextAvailableDocNumber(longBase, new Set())).toThrow(
      /exceeds 21/,
    )
  })

  it('throws after exhausting 99 suffix slots', () => {
    const base = 'TEST-001'
    const taken = new Set<string>([base])
    for (let n = 1; n <= 99; n++) taken.add(`${base}-${n}`)
    expect(() => findNextAvailableDocNumber(base, taken)).toThrow(
      /no available DocNumber/,
    )
  })
})
