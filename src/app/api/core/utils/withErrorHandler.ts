import {
  CopilotApiError,
  MessagableError,
  StatusableError,
} from '@/type/CopilotApiError'
import APIError from '@/app/api/core/exceptions/api'
import { FailedRecordCategoryType } from '@/app/api/core/types/log'
import httpStatus from 'http-status'
import { NextRequest, NextResponse } from 'next/server'
import { ZodError, ZodFormattedError } from 'zod'
import {
  isAxiosError,
  isIntuitOAuthError,
} from '@/app/api/core/exceptions/custom'
import * as Sentry from '@sentry/nextjs'
import {
  getMessageAndCodeFromError,
  HttpFetchError,
  RetryableError,
} from '@/utils/error'
import { getCategory } from '@/utils/synclog'

type RequestHandler = (req: NextRequest, params: any) => Promise<NextResponse>

/**
 * Reusable utility that wraps a given request handler with a global error handler to standardize response structure
 * in case of failures. Catches exceptions thrown from the handler, and returns a formatted error response.
 *
 * @param {RequestHandler} handler - The request handler to wrap.
 * @returns {RequestHandler} The new handler that includes error handling logic.
 * @example
 * const safeHandler = withErrorHandler(async (req: NextRequest) => {
 *   // your request handling logic
 *   if (errorCondition) {
 *     throw new Error("Oh no!")}
 *   return NextResponse.next();
 * });
 *
 * @throws {ZodError} Captures and handles validation errors and responds with status 400 and the issue detail.
 * @throws {CopilotApiError} Captures and handles CopilotAPI errors, uses the error status, and message if available.
 * @throws {APIError} Captures and handles APIError
 * @throws {AxiosError} Captures and handles AxiosError (Specially from Intuit SDK)
 */
export const withErrorHandler = (handler: RequestHandler): RequestHandler => {
  return async (req: NextRequest, params: any) => {
    // Execute the handler wrapped in a try... catch block
    try {
      return await handler(req, params)
    } catch (error: unknown) {
      // Format error in a readable way

      let formattedError = error
      if (error instanceof ZodError) {
        formattedError = error.format() as ZodFormattedError<string>
      }
      console.error(formattedError)

      // Default staus and message for JSON error response
      let status: number =
        (error as StatusableError).status || httpStatus.BAD_REQUEST
      let message: string | ZodFormattedError<string> =
        (error as MessagableError).body?.message || 'Something went wrong'
      let errors: unknown[] | undefined = undefined

      // Build a proper response based on the type of Error encountered
      if (error instanceof ZodError) {
        status = httpStatus.UNPROCESSABLE_ENTITY
        message = formattedError as ZodFormattedError<string>
      } else if (error instanceof CopilotApiError) {
        status = error.status || status
        message = error.body.message || message
      } else if (error instanceof APIError) {
        status = error.status
        message = error.message || message
        errors = error.errors
      } else if (error instanceof RetryableError) {
        status = error.status
        message = error.message || message
      } else if (error instanceof HttpFetchError) {
        status = error.status
        message = error.message || message
      } else if (isIntuitOAuthError(error)) {
        message = error.error
        status = httpStatus.BAD_REQUEST
      } else if (error instanceof Error && error.message) {
        message = error.message
      } else if (isAxiosError(error)) {
        message = error.response.data.error
        status = error.response.status
      }

      // Send categorized errors to Sentry with context tags
      if (error instanceof ZodError) {
        Sentry.withScope((scope) => {
          scope.setTag('errorCategory', FailedRecordCategoryType.VALIDATION)
          Sentry.captureException(error)
        })
      } else if (
        error instanceof APIError ||
        error instanceof CopilotApiError ||
        error instanceof HttpFetchError ||
        isAxiosError(error) ||
        isIntuitOAuthError(error)
      ) {
        const errorWithCode = getMessageAndCodeFromError(error)
        const category = getCategory(errorWithCode)

        Sentry.withScope((scope) => {
          scope.setTag('errorCategory', category)
          if (errorWithCode.source && errorWithCode.source !== 'unknown') {
            scope.setTag('errorSource', errorWithCode.source)
          }
          Sentry.captureException(error)
        })
      }

      return NextResponse.json({ error: message, errors }, { status })
    }
  }
}
