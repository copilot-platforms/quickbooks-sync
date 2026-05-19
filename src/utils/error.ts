import APIError from '@/app/api/core/exceptions/api'
import {
  isAxiosError,
  isIntuitOAuthError,
} from '@/app/api/core/exceptions/custom'
import { OAuthErrorCodes } from '@/constant/intuitErrorCode'
import { CopilotApiError, MessagableError } from '@/type/CopilotApiError'
import { QBFaultErrorSchemaType, QBFaultSchema } from '@/type/dto/intuitAPI.dto'
import { refreshTokenExpireMessage } from '@/utils/auth'
import { IntuitAPIErrorMessage } from '@/utils/intuitAPI'
import httpStatus from 'http-status'
import { ZodError } from 'zod'

export type IntuitErrorType = {
  Message: string
  Detail: string
  code: string
  element?: string
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
    let statusCode = error.status

    const isIntuitError = error.message.includes(IntuitAPIErrorMessage)
    if (isIntuitError) {
      const firstFault = error.errors?.[0] as QBFaultErrorSchemaType | undefined
      errorMessage = firstFault?.Detail ?? errorMessage
      statusCode = firstFault?.code ?? statusCode
    }
    return {
      message: errorMessage,
      code: statusCode,
      source: isIntuitError ? 'intuit' : 'unknown',
    }
  } else if (isIntuitOAuthError(error)) {
    const message =
      error.error === OAuthErrorCodes.INVALID_GRANT
        ? refreshTokenExpireMessage
        : error.error
    return { message, code: httpStatus.BAD_REQUEST, source: 'intuit' }
  } else if (error instanceof HttpFetchError) {
    // Surface real upstream status to qb_sync_logs. Source inferred by URL
    // substring (intuit.com / copilot.app); revisit if either host migrates.
    const source: 'intuit' | 'copilot' | 'unknown' = error.url.includes(
      'intuit',
    )
      ? 'intuit'
      : error.url.includes('copilot')
        ? 'copilot'
        : 'unknown'
    // For Intuit, prefer the QBO Fault.Error[0].code (e.g. 5010, 6140) over
    // the HTTP status (usually 400). QBFaultSchema already coerces string
    // codes to numbers; fall back to error.status when no Fault is present
    // (timeouts, generic 5xx, etc.).
    let code = error.status
    if (source === 'intuit') {
      const fault = QBFaultSchema.safeParse(error.body)
      const faultCode = fault.success
        ? fault.data.Fault.Error[0]?.code
        : undefined
      if (typeof faultCode === 'number') code = faultCode
    }
    return { message: error.message, code, source }
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
