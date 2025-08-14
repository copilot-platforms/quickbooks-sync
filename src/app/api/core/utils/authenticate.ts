import { CopilotAPI } from '@/utils/copilotAPI'
import { NextRequest } from 'next/server'
import User from '@/app/api/core/models/User.model'
import { z } from 'zod'
import { TokenSchema } from '@/type/common'
import APIError from '@/app/api/core/exceptions/api'
import httpStatus from 'http-status'
import { withRetry } from '@/app/api/core/utils/withRetry'

export const _authenticateWithToken = async (token: string): Promise<User> => {
  const copilotClient = new CopilotAPI(token)
  const payload = TokenSchema.safeParse(await copilotClient.getTokenPayload())

  if (!payload.success) {
    throw new APIError(httpStatus.UNAUTHORIZED, 'Failed to authenticate token')
  }

  // Access to IU and webhook events.
  if (
    !payload.data.internalUserId &&
    (payload.data.clientId || payload.data.companyId)
  ) {
    throw new APIError(
      httpStatus.UNAUTHORIZED,
      'You do not have access to this resource',
    )
  }

  return new User(token, payload.data)
}
export const authenticateWithToken = (...args: unknown[]) =>
  withRetry(_authenticateWithToken, args)

/**
 * Token parser and authentication util
 *
 * `authenticate` takes in the current request, parses the "token" searchParam from it,
 * uses `CopilotAPI` to check if the user token is valid
 * and finally returns an instance of `User` that is associated with this request
 */
const authenticate = async (req: NextRequest) => {
  // Fetch token from search param and validate it
  const token = req.nextUrl.searchParams.get('token')
  const tokenParsed = z.string().safeParse(token)
  if (!tokenParsed.success || !tokenParsed.data) {
    throw new APIError(httpStatus.UNAUTHORIZED, 'Please provide a valid token')
  }

  // Parse token payload from valid token
  return await authenticateWithToken(tokenParsed.data)
}

export default authenticate
