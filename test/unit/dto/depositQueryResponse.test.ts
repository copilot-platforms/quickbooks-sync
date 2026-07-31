import { describe, it, expect } from 'vitest'
import { QBDepositQueryResponseSchema } from '@/type/dto/intuitAPI.dto'

describe('QBDepositQueryResponseSchema', () => {
  it('parses a QueryResponse with deposits', () => {
    const parsed = QBDepositQueryResponseSchema.parse({
      Deposit: [{ Id: 'dep-1', PrivateNote: 'Stripe payout po_1' }],
    })
    expect(parsed.Deposit?.[0].Id).toBe('dep-1')
  })

  it('parses an empty QueryResponse (no Deposit key)', () => {
    const parsed = QBDepositQueryResponseSchema.parse({})
    expect(parsed.Deposit).toBeUndefined()
  })
})
