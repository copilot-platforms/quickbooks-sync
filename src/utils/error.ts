import APIError from '@/app/api/core/exceptions/api'
import {
  isAxiosError,
  isIntuitOAuthError,
} from '@/app/api/core/exceptions/custom'
import { OAuthErrorCodes } from '@/constant/intuitErrorCode'
import { CopilotApiError, MessagableError } from '@/type/CopilotApiError'
import { refreshTokenExpireMessage } from '@/utils/auth'
import { IntuitAPIErrorMessage } from '@/utils/intuitAPI'
import httpStatus from 'http-status'
import { ZodError } from 'zod'

export type IntuitErrorType = {
  Message: string
  Detail: string
  Code: string
  Element?: string
}

export type ErrorMessageAndCode = {
  message: string
  code: number
  source?: 'intuit' | 'copilot' | 'unknown'
  isValidationError?: boolean
}

export const getMessageAndCodeFromError = (
  error: unknown,
): ErrorMessageAndCode => {
  // Default staus and message for JSON error response
  const message: string =
    (error as MessagableError).body?.message || 'Something went wrong'
  const code: number = httpStatus.INTERNAL_SERVER_ERROR

  // Build a proper response based on the type of Error encountered
  if (error instanceof ZodError) {
    return {
      message: error.message,
      code: httpStatus.UNPROCESSABLE_ENTITY,
      source: 'unknown',
      isValidationError: true,
    }
  } else if (error instanceof CopilotApiError) {
    return {
      message: error.body.message || message,
      code: error.status,
      source: 'copilot',
    }
  } else if (error instanceof APIError) {
    let errorMessage = error.message || message
    const isIntuitError = error.message.includes(IntuitAPIErrorMessage)
    if (isIntuitError) {
      errorMessage = (error.errors?.[0] as IntuitErrorType).Detail
    }
    return {
      message: errorMessage,
      code: error.status,
      source: isIntuitError ? 'intuit' : 'unknown',
    }
  } else if (isIntuitOAuthError(error)) {
    const message =
      error.error === OAuthErrorCodes.INVALID_GRANT
        ? refreshTokenExpireMessage
        : error.error
    return { message, code: httpStatus.BAD_REQUEST, source: 'intuit' }
  } else if (error instanceof HttpFetchError) {
    // Transport-layer failure (non-2xx response from QBO/Copilot). Surface
    // the real upstream status so qb_sync_logs records 503 as 503 instead of
    // bucketing every transport failure as a generic 500.
    //
    // Source is inferred from a substring match on the request URL. Expected
    // hostnames at time of writing:
    //   intuit:  quickbooks.api.intuit.com (prod) / sandbox-quickbooks.api.intuit.com
    //   copilot: api.copilot.app (prod) / api.copilot-staging.app
    // If either vendor migrates to a domain that omits these substrings (e.g.
    // a future `api.assembly.com`), revisit this heuristic — `unknown` would
    // mislabel qb_sync_logs.source and skew the reaper/retry buckets.
    const source: 'intuit' | 'copilot' | 'unknown' = error.url.includes(
      'intuit',
    )
      ? 'intuit'
      : error.url.includes('copilot')
        ? 'copilot'
        : 'unknown'
    return { message: error.message, code: error.status, source }
  } else if (error instanceof Error && error.message) {
    return { message: error.message, code, source: 'unknown' }
  } else if (isAxiosError(error)) {
    return {
      message: error.response.data.error,
      code: error.response.status,
      source: 'unknown',
    }
  }
  return { message, code, source: 'unknown' }
}

export class RetryableError extends Error {
  readonly retry: boolean
  readonly status: number

  constructor(status: number, message: string, retry: boolean) {
    super(message)
    this.retry = retry
    this.status = status
  }
}

export class HttpFetchError extends Error {
  readonly status: number
  readonly statusText: string
  readonly url: string
  readonly body: unknown

  constructor(args: {
    status: number
    statusText: string
    url: string
    body: unknown
    message?: string
  }) {
    super(
      args.message ??
        `HTTP ${args.status} ${args.statusText || ''} from ${args.url}`.trim(),
    )
    this.name = 'HttpFetchError'
    this.status = args.status
    this.statusText = args.statusText
    this.url = args.url
    this.body = args.body
  }
}
