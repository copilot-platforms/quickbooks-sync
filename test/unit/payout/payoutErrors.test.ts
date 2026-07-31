import { describe, it, expect } from 'vitest'
import httpStatus from 'http-status'

import APIError from '@/app/api/core/exceptions/api'
import { refreshTokenExpireMessage } from '@/utils/auth'
import {
  TerminalPayoutError,
  MixedPayoutIntentError,
  getShouldRetryForPayout,
} from '@/app/api/quickbooks/payout/payout.errors'

describe('getShouldRetryForPayout', () => {
  it('is terminal for deterministic payout errors', () => {
    expect(
      getShouldRetryForPayout(new TerminalPayoutError('refund lines')),
    ).toBe(false)
    expect(getShouldRetryForPayout(new MixedPayoutIntentError('mixed'))).toBe(
      false,
    )
  })

  it('is retryable for an unresolved-invoice NOT_FOUND (webhook ordering)', () => {
    expect(
      getShouldRetryForPayout(
        new APIError(httpStatus.NOT_FOUND, 'no PAID log'),
      ),
    ).toBe(true)
  })

  it('is terminal for a dead refresh token (AUTH)', () => {
    expect(getShouldRetryForPayout(new Error(refreshTokenExpireMessage))).toBe(
      false,
    )
  })

  it('treats a mixed-intent error as a terminal payout error', () => {
    expect(new MixedPayoutIntentError('x') instanceof TerminalPayoutError).toBe(
      true,
    )
  })
})
