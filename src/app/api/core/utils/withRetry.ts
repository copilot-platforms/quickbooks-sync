import pRetry, { FailedAttemptError } from 'p-retry'
import * as Sentry from '@sentry/nextjs'
import { RetryableError } from '@/utils/error'

const RETRYABLE_HTTP_STATUSES: ReadonlySet<number> = new Set([
  429, // rate limit
  500, // internal server error (often transient at QBO)
  502, // bad gateway (upstream proxy hiccup)
  503, // service unavailable
  504, // gateway timeout
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

/**
 * Centralized classifier for whether an error should trigger a retry.
 * Exported so it can be unit-tested independent of pRetry's timer plumbing.
 *
 * The error shapes inspected here come from different layers; a single
 * unified type doesn't exist, which is why the input is `unknown` and
 * each field is checked defensively:
 *
 *   - `RetryableError` (ours, src/utils/error.ts) — explicit retry flag.
 *   - `HttpFetchError` (ours) and Copilot SDK's `StatusableError` —
 *     `status: number` set after a non-2xx response was received.
 *   - undici (Node fetch) network failures — thrown as
 *     `TypeError: fetch failed` with the underlying error on `.cause`
 *     (e.g. `{ code: 'ECONNRESET' }`). No HTTP response was ever built,
 *     so there is no status to inspect.
 *   - `AbortSignal.timeout()` rejects with a `DOMException` whose
 *     `name` is `'TimeoutError'` (retryable). `AbortController.abort()`
 *     produces `'AbortError'` and is NOT retried (deliberate cancellation).
 *   - Top-level `error.code` is checked defensively for legacy Node
 *     error paths; in current Node fetch the code lives under `.cause`.
 *
 * Retry-nesting hazard: do not call a `withRetry`-wrapped function from
 * inside another `withRetry`-wrapped function. With the broadened retry
 * set, worst-case wait is `outer × inner × per_call_timeout`, which can
 * blow past the 300s webhook execution budget. Inside `IntuitAPI._*`
 * methods that are themselves wrapped at the public level (see exports
 * at the bottom of `src/utils/intuitAPI.ts`), call the unwrapped `_*`
 * counterparts directly (e.g. `this._customQuery`, not `this.customQuery`).
 */
export const isRetryableError = (error: unknown): boolean => {
  if (error instanceof RetryableError) return error.retry

  if (typeof error !== 'object' || error === null) return false

  const err = error as {
    status?: unknown
    code?: unknown
    name?: unknown
    message?: unknown
    cause?: unknown
  }

  if (typeof err.status === 'number' && RETRYABLE_HTTP_STATUSES.has(err.status))
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
      shouldRetry: (error: unknown) => isRetryableError(error),
    },
  )
}
