import { describe, it, expect } from 'vitest'
import { PayoutLineItemSchema } from '@/type/dto/webhook.dto'

describe('PayoutLineItemSchema', () => {
  it('parses a valid line item', () => {
    const parsed = PayoutLineItemSchema.parse({
      copilotInvoiceId: 'inv-cop-0001',
      grossAmount: 20000,
      feeAmount: 375,
    })
    expect(parsed.copilotInvoiceId).toBe('inv-cop-0001')
  })

  it('rejects a line item missing the invoice id', () => {
    expect(() =>
      PayoutLineItemSchema.parse({ grossAmount: 1, feeAmount: 0 }),
    ).toThrow()
  })
})
