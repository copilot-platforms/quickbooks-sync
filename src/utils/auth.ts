interface Tokenable {
  accessToken: string
}
export const validateAccessToken = (tokenPayload: Tokenable) => {
  if (tokenPayload.accessToken === '') {
    throw new Error('Refresh token is expired')
  }
}
