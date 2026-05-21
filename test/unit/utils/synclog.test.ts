import { describe, it, expect } from 'vitest'

import { getShouldRetryForCategory } from '@/utils/synclog'
import { QBOErrorCodes } from '@/constant/intuitErrorCode'
import { refreshTokenExpireMessage } from '@/utils/auth'

describe('getShouldRetryForCategory', () => {
  it('returns true when no error is provided', () => {
    expect(getShouldRetryForCategory(undefined)).toBe(true)
  })

  it('returns true for ACCOUNT category (QBO account suspended, code 6190) so the cron retries once subscription is restored', () => {
    expect(
      getShouldRetryForCategory({
        message: 'Account Suspended',
        code: QBOErrorCodes.ACCOUNT_SUSPENDED,
        source: 'intuit',
      }),
    ).toBe(true)
  })

  it('returns true for ACCOUNT category (business validation, code 6000) so the cron retries once subscription is restored', () => {
    expect(
      getShouldRetryForCategory({
        message: 'Business validation failed',
        code: QBOErrorCodes.BUSINESS_VALIDATION,
        source: 'intuit',
      }),
    ).toBe(true)
  })

  it('returns false for AUTH category (refresh token expired)', () => {
    expect(
      getShouldRetryForCategory({
        message: refreshTokenExpireMessage,
        code: 400,
        source: 'intuit',
      }),
    ).toBe(false)
  })

  it('returns true for RATE_LIMIT (code 429)', () => {
    expect(
      getShouldRetryForCategory({
        message: 'Too Many Requests',
        code: 429,
      }),
    ).toBe(true)
  })

  it('returns true for VALIDATION errors', () => {
    expect(
      getShouldRetryForCategory({
        message: 'bad payload',
        code: 422,
        isValidationError: true,
      }),
    ).toBe(true)
  })

  it('returns true for generic Intuit QB_API_ERROR', () => {
    expect(
      getShouldRetryForCategory({
        message: 'Stale Object Error',
        code: 5010,
        source: 'intuit',
      }),
    ).toBe(true)
  })

  it('returns true for MAPPING_NOT_FOUND', () => {
    expect(
      getShouldRetryForCategory({
        message: 'customer not found',
        code: 404,
      }),
    ).toBe(true)
  })

  it('returns true for OTHERS', () => {
    expect(
      getShouldRetryForCategory({ message: 'something else', code: 500 }),
    ).toBe(true)
  })
})
