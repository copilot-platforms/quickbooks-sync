import { describe, it, expect } from 'vitest'
import { SettingRequestSchema, SettingType } from '@/type/common'

describe('SettingRequestSchema — invoice bank deposit validation', () => {
  const base = {
    type: SettingType.INVOICE,
    absorbedFeeFlag: false,
    useCompanyNameFlag: false,
  }

  it('accepts bank deposit off without a bank account', () => {
    const r = SettingRequestSchema.safeParse({
      ...base,
      bankDepositFeeFlag: false,
    })
    expect(r.success).toBe(true)
  })

  it('rejects bank deposit on without a bank account', () => {
    const r = SettingRequestSchema.safeParse({
      ...base,
      bankDepositFeeFlag: true,
    })
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(
        r.error.issues.some((i) => i.path.includes('bankAccountRef')),
      ).toBe(true)
    }
  })

  it('accepts bank deposit on with a bank account', () => {
    const r = SettingRequestSchema.safeParse({
      ...base,
      bankDepositFeeFlag: true,
      bankAccountRef: '123',
    })
    expect(r.success).toBe(true)
  })

  it('rejects invoice missing bankDepositFeeFlag', () => {
    const r = SettingRequestSchema.safeParse({ ...base })
    expect(r.success).toBe(false)
  })
})
