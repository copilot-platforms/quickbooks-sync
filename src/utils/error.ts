import APIError from '@/app/api/core/exceptions/api'
import { isAxiosError } from '@/app/api/core/exceptions/custom'
import { CopilotApiError, MessagableError } from '@/type/CopilotApiError'
import { IntuitAPIErrorMessage } from '@/utils/intuitAPI'

export type IntuitErrorType = {
  Message: string
  Detail: string
  Code: string
  Element?: string
}

export const getMessageFromError = (error: unknown): string => {
  // Default staus and message for JSON error response
  const message: string =
    (error as MessagableError).body?.message || 'Something went wrong'

  // Build a proper response based on the type of Error encountered
  if (error instanceof CopilotApiError) {
    return error.body.message || message
  } else if (error instanceof APIError) {
    let errorMessage = error.message || message
    if (error.message.includes(IntuitAPIErrorMessage)) {
      errorMessage = (error.errors?.[0] as IntuitErrorType).Detail
    }
    return errorMessage
  } else if (error instanceof Error && error.message) {
    return error.message
  } else if (isAxiosError(error)) {
    return error.response.data.error
  }
  return message
}
