import APIError from '@/app/api/core/exceptions/api'
import { isAxiosError } from '@/app/api/core/exceptions/custom'
import { CopilotApiError, MessagableError } from '@/type/CopilotApiError'

export const getMessageFromError = (error: unknown): string => {
  // Default staus and message for JSON error response
  const message: string =
    (error as MessagableError).body?.message || 'Something went wrong'

  // Build a proper response based on the type of Error encountered
  if (error instanceof CopilotApiError) {
    return error.body.message || message
  } else if (error instanceof APIError) {
    return error.message || message
  } else if (error instanceof Error && error.message) {
    return error.message
  } else if (isAxiosError(error)) {
    return error.response.data.error
  }
  return message
}
