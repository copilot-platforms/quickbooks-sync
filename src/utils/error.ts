import APIError from '@/app/api/core/exceptions/api'
import { isAxiosError } from '@/app/api/core/exceptions/custom'
import { CopilotApiError, MessagableError } from '@/type/CopilotApiError'
import { IntuitAPIErrorMessage } from '@/utils/intuitAPI'
import httpStatus from 'http-status'

export type IntuitErrorType = {
  Message: string
  Detail: string
  Code: string
  Element?: string
}

export type ErrorMessageAndCode = {
  message: string
  code: number
}

export const getMessageAndCodeFromError = (
  error: unknown,
): ErrorMessageAndCode => {
  // Default staus and message for JSON error response
  const message: string =
    (error as MessagableError).body?.message || 'Something went wrong'
  const code: number = httpStatus.INTERNAL_SERVER_ERROR

  // Build a proper response based on the type of Error encountered
  if (error instanceof CopilotApiError) {
    return { message: error.body.message || message, code: error.status }
  } else if (error instanceof APIError) {
    let errorMessage = error.message || message
    if (error.message.includes(IntuitAPIErrorMessage)) {
      errorMessage = (error.errors?.[0] as IntuitErrorType).Detail
    }
    return { message: errorMessage, code: error.status }
  } else if (error instanceof Error && error.message) {
    return { message: error.message, code }
  } else if (isAxiosError(error)) {
    return { message: error.response.data.error, code: error.response.status }
  }
  return { message, code }
}
