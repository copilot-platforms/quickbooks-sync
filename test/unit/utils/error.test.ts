/**
 * Unit tests for `getMessageAndCodeFromError` — the helper that normalises
 * any thrown error into the `{ message, code, source }` triple that
 * webhook/payment/sync handlers write into qb_sync_logs.
 *
 * Coverage focus is the HttpFetchError → Intuit branch: when QBO returns
 * HTTP 400 with a Fault payload (e.g. 5010 stale-object), the function
 * must surface the *Fault.Error[0].code* (5010), not the HTTP status (400),
 * so the downstream notification registry lookup keys correctly and
 * sync_log.error_code stores the QBO code rather than the HTTP envelope.
 */

import { describe, it, expect } from 'vitest'
import { getMessageAndCodeFromError, HttpFetchError } from '@/utils/error'

const intuitUrl =
  'https://sandbox-quickbooks.api.intuit.com/v3/company/123/invoice?minorversion=70'

const makeIntuitHttpError = (
  body: unknown,
  message = 'Stale Object Error : ...',
) =>
  new HttpFetchError({
    status: 400,
    statusText: 'Bad Request',
    url: intuitUrl,
    body,
    message,
  })

describe('getMessageAndCodeFromError — HttpFetchError (Intuit branch)', () => {
  it('uses Fault.Error[0].code instead of HTTP status when Fault is present', () => {
    const body = {
      Fault: {
        Error: [
          {
            code: '5010',
            Message: 'Stale Object Error',
            Detail: 'Stale Object Error : You and ...',
          },
        ],
        type: 'ValidationFault',
      },
    }
    const result = getMessageAndCodeFromError(makeIntuitHttpError(body))
    expect(result.code).toBe(5010)
    expect(result.source).toBe('intuit')
  })

  it('handles numeric Fault code without coercion regressions', () => {
    const body = { Fault: { Error: [{ code: 6140 }] } }
    const result = getMessageAndCodeFromError(makeIntuitHttpError(body))
    expect(result.code).toBe(6140)
  })

  it('falls back to HTTP status when no Fault payload is present', () => {
    const result = getMessageAndCodeFromError(
      makeIntuitHttpError(undefined, 'HTTP 500 Internal Server Error'),
    )
    expect(result.code).toBe(400)
    expect(result.source).toBe('intuit')
  })

  it('falls back to HTTP status when Fault.Error is empty', () => {
    const result = getMessageAndCodeFromError(
      makeIntuitHttpError({ Fault: { Error: [] } }),
    )
    expect(result.code).toBe(400)
  })

  it('falls back to HTTP status when code is non-numeric / missing', () => {
    const result = getMessageAndCodeFromError(
      makeIntuitHttpError({ Fault: { Error: [{ Message: 'no code' }] } }),
    )
    expect(result.code).toBe(400)
  })

  it('keeps HTTP status for non-Intuit hosts even if a Fault-like body sneaks in', () => {
    const copilotErr = new HttpFetchError({
      status: 400,
      statusText: 'Bad Request',
      url: 'https://api.copilot.app/things',
      body: { Fault: { Error: [{ code: '5010' }] } },
      message: 'whatever',
    })
    const result = getMessageAndCodeFromError(copilotErr)
    expect(result.code).toBe(400)
    expect(result.source).toBe('copilot')
  })
})
