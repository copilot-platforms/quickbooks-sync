import { describe, expect, it } from 'vitest'
import {
  findNextAvailableDocNumber,
  formatAssemblyInvoicePrivateNote,
  isQBODuplicateDocNumberError,
  MAX_SUFFIX_ATTEMPTS,
} from '@/app/api/quickbooks/invoice/invoice.utils'
import { QBOErrorCodes } from '@/constant/intuitErrorCode'

const DUP_DOC_NUMBER = QBOErrorCodes.DUPLICATE_DOC_NUMBER
const DUP_DOC_NUMBER_STR = String(DUP_DOC_NUMBER)

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
    const taken = new Set(['MFBZU6WM-00002SOMETHING', 'MFBZU6WM-00002-1-EXTRA'])
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

  it('throws after exhausting MAX_SUFFIX_ATTEMPTS slots', () => {
    const base = 'TEST-001'
    const taken = new Set<string>([base])
    for (let n = 1; n <= MAX_SUFFIX_ATTEMPTS; n++) taken.add(`${base}-${n}`)
    expect(() => findNextAvailableDocNumber(base, taken)).toThrow(
      /no available DocNumber/,
    )
  })
})

describe('isQBODuplicateDocNumberError', () => {
  it('matches the real APIError shape thrown by intuitAPI._createInvoice', () => {
    // Actual shape: status=400, message=boilerplate, errors=array of QBO
    // fault objects. The duplicate code lives in errors[i].code.
    const realApiError = {
      status: 400,
      message: '#IntuitAPIErrorMessage#createInvoice',
      errors: [
        {
          code: DUP_DOC_NUMBER_STR,
          Message: 'Duplicate Document Number Error',
          Detail:
            'Duplicate Document Number Error : You must specify a different number. This number has already been used.',
          Element: '',
        },
      ],
    }
    expect(isQBODuplicateDocNumberError(realApiError)).toBe(true)
  })

  it('matches when errors[i].code is numeric', () => {
    expect(
      isQBODuplicateDocNumberError({
        status: 400,
        errors: [{ code: DUP_DOC_NUMBER }],
      }),
    ).toBe(true)
  })

  it('matches via errors[i].Detail when code is absent', () => {
    expect(
      isQBODuplicateDocNumberError({
        status: 400,
        errors: [{ Detail: 'Duplicate Document Number Error: …' }],
      }),
    ).toBe(true)
  })

  it('matches the duplicate code at the top-level .status (defense-in-depth)', () => {
    expect(isQBODuplicateDocNumberError({ status: DUP_DOC_NUMBER })).toBe(true)
  })

  it('matches the duplicate code at the top-level .code (defense-in-depth)', () => {
    expect(isQBODuplicateDocNumberError({ code: DUP_DOC_NUMBER_STR })).toBe(
      true,
    )
  })

  it('matches top-level .message text (defense-in-depth)', () => {
    expect(
      isQBODuplicateDocNumberError({
        message: 'Duplicate Document Number Error',
      }),
    ).toBe(true)
  })

  it('returns false for unrelated APIError shapes', () => {
    expect(
      isQBODuplicateDocNumberError({
        status: 400,
        message: '#IntuitAPIErrorMessage#createInvoice',
        errors: [{ code: '5010', Detail: 'Stale object error' }],
      }),
    ).toBe(false)
  })

  it('returns false for unrelated errors', () => {
    expect(isQBODuplicateDocNumberError({ code: 5010 })).toBe(false)
    expect(isQBODuplicateDocNumberError({ status: 400 })).toBe(false)
    expect(isQBODuplicateDocNumberError(null)).toBe(false)
    expect(isQBODuplicateDocNumberError(undefined)).toBe(false)
    expect(isQBODuplicateDocNumberError('not an object')).toBe(false)
    expect(isQBODuplicateDocNumberError({})).toBe(false)
    expect(isQBODuplicateDocNumberError([])).toBe(false)
  })
})
