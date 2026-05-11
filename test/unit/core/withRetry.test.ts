import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { RetryableError } from '@/utils/error'
import { withRetry, isRetryableError } from '@/app/api/core/utils/withRetry'

vi.mock('@sentry/nextjs', () => ({
  withScope: vi.fn(),
}))

describe('isRetryableError', () => {
  it('returns the retry flag from RetryableError', () => {
    expect(isRetryableError(new RetryableError(500, 'x', true))).toBe(true)
    expect(isRetryableError(new RetryableError(500, 'x', false))).toBe(false)
  })

  it('treats 429/500/502/503/504 as retryable, others as not', () => {
    for (const status of [429, 500, 502, 503, 504]) {
      expect(isRetryableError(Object.assign(new Error(), { status }))).toBe(
        true,
      )
    }
    for (const status of [400, 401, 404, 501]) {
      expect(isRetryableError(Object.assign(new Error(), { status }))).toBe(
        false,
      )
    }
  })

  it('treats undici-style fetch failure with network code on cause as retryable', () => {
    const err = Object.assign(new TypeError('fetch failed'), {
      cause: { code: 'ECONNRESET' },
    })
    expect(isRetryableError(err)).toBe(true)
  })

  it('treats AbortSignal.timeout TimeoutError as retryable', () => {
    const err = Object.assign(new Error('timed out'), { name: 'TimeoutError' })
    expect(isRetryableError(err)).toBe(true)
  })

  it('treats AbortError as retryable', () => {
    const err = Object.assign(new Error('aborted'), { name: 'AbortError' })
    expect(isRetryableError(err)).toBe(true)
  })

  it('treats top-level network code as retryable', () => {
    const err = Object.assign(new Error('boom'), { code: 'ETIMEDOUT' })
    expect(isRetryableError(err)).toBe(true)
  })

  it('returns false for non-error inputs', () => {
    expect(isRetryableError(null)).toBe(false)
    expect(isRetryableError(undefined)).toBe(false)
    expect(isRetryableError('oops')).toBe(false)
  })
})

describe('withRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('returns the result on first success', async () => {
    const fn = vi.fn().mockResolvedValue('ok')

    const result = await withRetry(fn, ['arg1'])

    expect(result).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith('arg1')
  })

  it('retries on 429 and succeeds', async () => {
    const error = Object.assign(new Error('rate limited'), { status: 429 })
    const fn = vi
      .fn()
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce('recovered')

    const promise = withRetry(fn, [])
    await vi.runAllTimersAsync()

    expect(await promise).toBe('recovered')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('retries on RetryableError with retry=true', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new RetryableError(500, 'transient', true))
      .mockResolvedValueOnce('ok')

    const promise = withRetry(fn, [])
    await vi.runAllTimersAsync()

    expect(await promise).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('does not retry on RetryableError with retry=false', async () => {
    const fn = vi
      .fn()
      .mockRejectedValue(new RetryableError(500, 'permanent', false))

    await expect(withRetry(fn, [])).rejects.toThrow('permanent')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('does not retry on permanent 4xx responses', async () => {
    const error = Object.assign(new Error('bad request'), { status: 400 })
    const fn = vi.fn().mockRejectedValue(error)

    await expect(withRetry(fn, [])).rejects.toThrow('bad request')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it.each([500, 502, 503, 504])(
    'retries on transient %i and succeeds',
    async (status) => {
      const error = Object.assign(new Error(`transient ${status}`), { status })
      const fn = vi
        .fn()
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce('recovered')

      const promise = withRetry(fn, [])
      await vi.runAllTimersAsync()

      expect(await promise).toBe('recovered')
      expect(fn).toHaveBeenCalledTimes(2)
    },
  )

  it('retries on undici fetch-failed wrapping ECONNRESET and succeeds', async () => {
    const error = Object.assign(new TypeError('fetch failed'), {
      cause: { code: 'ECONNRESET' },
    })
    const fn = vi
      .fn()
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce('recovered')

    const promise = withRetry(fn, [])
    await vi.runAllTimersAsync()

    expect(await promise).toBe('recovered')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('retries on AbortSignal.timeout TimeoutError and succeeds', async () => {
    const error = Object.assign(new Error('timed out'), {
      name: 'TimeoutError',
    })
    const fn = vi
      .fn()
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce('recovered')

    const promise = withRetry(fn, [])
    await vi.runAllTimersAsync()

    expect(await promise).toBe('recovered')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('exhausts retries and throws on persistent 429', async () => {
    const error = Object.assign(new Error('rate limited'), { status: 429 })
    const fn = vi.fn().mockRejectedValue(error)

    // Attach rejection handler before advancing timers to avoid unhandled rejection
    const promise = withRetry(fn, []).catch((e: Error) => e)
    await vi.runAllTimersAsync()

    const result = await promise
    expect(result).toBeInstanceOf(Error)
    expect((result as Error).message).toBe('rate limited')
    // 1 initial + 4 retries = 5 total
    expect(fn).toHaveBeenCalledTimes(5)
  })
})
