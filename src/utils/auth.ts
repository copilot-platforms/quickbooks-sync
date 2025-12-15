interface Tokenable {
  accessToken: string
}

export const refreshTokenExpireMessage = 'Refresh token is expired'

export const validateAccessToken = (tokenPayload: Tokenable) => {
  if (tokenPayload.accessToken === '') {
    throw new Error(refreshTokenExpireMessage)
  }
}
