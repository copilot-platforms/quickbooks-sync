import pRetry, { FailedAttemptError } from 'p-retry'
import * as Sentry from '@sentry/nextjs'
import { RetryableError } from '@/utils/error'

// 429 means the server explicitly rejected the request without processing it,
// so retrying is always safe regardless of idempotency.
const ALWAYS_RETRY_STATUSES: ReadonlySet<number> = new Set([429])

// 5xx and network/timeout errors straddle "did not commit" and "committed but
// response dropped." Safe to replay on idempotent reads; on non-idempotent
// writes lacking a server-side request-key primitive, a retry after the upstream
// committed would duplicate the write — so the classifier returns false for
// these in `idempotent: false` mode.
const IDEMPOTENT_ONLY_RETRY_STATUSES: ReadonlySet<number> = new Set([
  500, 502, 503, 504,
])

const RETRYABLE_NETWORK_CODES: ReadonlySet<string> = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT',
])

const RETRYABLE_ERROR_NAMES: ReadonlySet<string> = new Set([
  'TimeoutError', // AbortSignal.timeout() rejection (Node 18+)
  // 'AbortError' is intentionally excluded — it signals a deliberate
  // AbortController.abort() and retrying would defeat the cancellation.
])

export type RetryOptions = {
  /**
   * False for non-idempotent writes (QBO create/update/void/delete) whose
   * upstream has no request-key dedupe. In strict mode the classifier
   * retries only on 429 and explicit `RetryableError.retry === true`;
   * 5xx, network errors, and AbortSignal timeouts all bubble. Defaults
   * to true (safe-to-replay reads).
   */
  idempotent?: boolean
}

/**
 * Classifies whether an error should trigger a retry. 429 and explicit
 * `RetryableError.retry === true` retry in both modes. Strict mode
 * (`options.idempotent === false`) short-circuits past 429: 5xx, network
 * codes, AbortSignal timeouts, and undici fetch-failed envelopes are all
 * treated as possibly-after-commit and never replayed.
 *
 * Retry-nesting hazard: don't call a wrapped function from inside another.
 * Inside `IntuitAPI._*` methods call the unwrapped `_*` counterparts
 * (e.g. `this._customQuery`, not `this.customQuery`).
 */
export const isRetryableError = (
  error: unknown,
  options: RetryOptions = {},
): boolean => {
  const { idempotent = true } = options

  if (error instanceof RetryableError) return error.retry

  if (typeof error !== 'object' || error === null) return false

  const err = error as {
    status?: unknown
    code?: unknown
    name?: unknown
    message?: unknown
    cause?: unknown
  }

  if (typeof err.status === 'number' && ALWAYS_RETRY_STATUSES.has(err.status))
    return true

  // Strict mode: nothing past this point is post-commit-safe.
  if (!idempotent) return false

  if (
    typeof err.status === 'number' &&
    IDEMPOTENT_ONLY_RETRY_STATUSES.has(err.status)
  )
    return true

  if (typeof err.name === 'string' && RETRYABLE_ERROR_NAMES.has(err.name))
    return true

  if (typeof err.code === 'string' && RETRYABLE_NETWORK_CODES.has(err.code))
    return true

  // Check `cause` BEFORE the generic 'fetch failed' message match so undici
  // envelopes with a known-permanent sub-code (e.g. ENOTFOUND for DNS, ENETUNREACH)
  // short-circuit to non-retryable instead of being retried 5× pointlessly.
  if (err.cause && typeof err.cause === 'object') {
    const cause = err.cause as { code?: unknown; name?: unknown }
    if (
      typeof cause.code === 'string' &&
      RETRYABLE_NETWORK_CODES.has(cause.code)
    )
      return true
    if (typeof cause.name === 'string' && RETRYABLE_ERROR_NAMES.has(cause.name))
      return true
    // cause is present with a recognized shape but not in either retry set →
    // treat as permanent (DNS failure, cert error, etc.).
    if (typeof cause.code === 'string' || typeof cause.name === 'string')
      return false
  }

  // Fallback: undici wraps low-level network errors as `TypeError: fetch failed`.
  // Only reach this branch when no usable cause was attached — treat as a
  // generic transient network blip.
  if (typeof err.message === 'string' && err.message === 'fetch failed')
    return true

  return false
}

export const withRetry = async <T>(
  fn: (...args: any[]) => Promise<T>,
  args: any[],
  options: RetryOptions = {},
): Promise<T> => {
  let isEventProcessorRegistered = false

  return await pRetry(
    async () => {
      try {
        return await fn(...args)
      } catch (error) {
        // Hopefully now sentry doesn't report retry errors as well. We have enough triage issues as it is
        Sentry.withScope((scope) => {
          if (isEventProcessorRegistered) return

          isEventProcessorRegistered = true
          scope.addEventProcessor((event) => {
            if (
              event.level === 'error' &&
              event.message &&
              event.message.includes('An error occurred during retry')
            ) {
              return null // Discard the event as it occured during retry
            }
            return event
          })
        })
        // Rethrow the error so pRetry can rety
        throw error
      }
    },

    {
      // Tuned so that maxTimeout actually engages on the final attempt.
      // With minTimeout=500, factor=4, retries=4 the back-off sequence is
      // 500ms / 2000ms / 8000ms / 10000ms (capped) = ~20.5s of waiting
      // across 5 total attempts. Combined with the 30s fetch timeout, a
      // single op caps at ~170s — well within the 300s webhook budget
      // and gives the upstream a meaningful recovery window.
      retries: 4,
      minTimeout: 500,
      maxTimeout: 10_000,
      factor: 4,
      onFailedAttempt: (error: FailedAttemptError) => {
        console.warn(
          `CopilotAPI#withRetry | Attempt ${error.attemptNumber} failed. There are ${error.retriesLeft} retries left. Error:`,
          error,
        )
      },
      shouldRetry: (error: unknown) => isRetryableError(error, options),
    },
  )
}
