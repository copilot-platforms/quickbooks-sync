import APIError from '@/app/api/core/exceptions/api'
import httpStatus from 'http-status'

interface Tokenable {
  accessToken: string
}
export const validateAccessToken = (tokenPayload: Tokenable) => {
  if (tokenPayload.accessToken === '') {
    throw new APIError(httpStatus.UNAUTHORIZED, 'Refresh token is expired')
  }
}
