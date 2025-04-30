declare module 'intuit-oauth' {
  export type EnvironmentType = 'sandbox' | 'production'

  interface OAuthClientConfig {
    clientId: string
    clientSecret: string
    environment: EnvironmentType
    redirectUri: string
    logging?: boolean
  }

  interface TokenResponse {
    token_type: string
    access_token: string
    refresh_token: string
    expires_in: number
    x_refresh_token_expires_in: number
    [key: string]: any
  }

  class OAuthClient {
    constructor(config: OAuthClientConfig)
    authorizeUri(options: { scope: string[]; state: string }): Promise<string>
    createToken(code: string): Promise<{ token: TokenResponse }>
    refreshUsingToken(refreshToken: string): Promise<{ token: TokenResponse }>
  }

  export const scopes: {
    Accounting: string
    OpenId: string
  }

  export = OAuthClient
}
