import { describe, expect, it } from 'vitest'
import { formatAssemblyInvoicePrivateNote } from '@/app/api/quickbooks/invoice/invoice.utils'

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
