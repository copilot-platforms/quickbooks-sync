import { describe, it, expect } from 'vitest'

import { getUsStateCode } from '@/utils/common'

describe('getUsStateCode', () => {
  it('converts a full state name to its two-letter code', () => {
    expect(getUsStateCode('California')).toBe('CA')
    expect(getUsStateCode('New York')).toBe('NY')
  })

  it('is case-insensitive and ignores surrounding whitespace', () => {
    expect(getUsStateCode('  california ')).toBe('CA')
    expect(getUsStateCode('TEXAS')).toBe('TX')
  })

  it('returns null when no state is given', () => {
    expect(getUsStateCode(undefined)).toBeNull()
    expect(getUsStateCode('')).toBeNull()
    expect(getUsStateCode('   ')).toBeNull()
  })

  it('returns null for a name that is not a US state', () => {
    expect(getUsStateCode('Ontario')).toBeNull()
    expect(getUsStateCode('not a real place')).toBeNull()
  })
})
