import { IntuitOAuthError } from '@/app/api/core/exceptions/custom'
import { RetryOptions, withRetry } from '@/app/api/core/utils/withRetry'
import {
  intuitClientId,
  intuitClientSecret,
  intuitEnvironment,
  intuitRedirectUri,
} from '@/config'
import {
  QBAuthTokenResponse,
  QBAuthTokenResponseSchema,
} from '@/type/dto/qbAuthToken.dto'
import OAuthClient from 'intuit-oauth'

export default class Intuit {
  private static instance: Intuit
  private intuitQB: OAuthClient

  constructor() {
    this.intuitQB = this.intializeSDK()
  }

  private intializeSDK() {
    return new OAuthClient({
      clientId: intuitClientId,
      clientSecret: intuitClientSecret,
      redirectUri: intuitRedirectUri,
      environment: intuitEnvironment,
    })
  }

  static getInstance() {
    if (!Intuit.instance) {
      Intuit.instance = new Intuit()
    }
    return Intuit.instance
  }

  static getSDK() {
    return Intuit.instance.intuitQB
  }

  async _authorizeUri(state: { token: string; originUrl?: string }) {
    try {
      // AuthorizationUri
      const authUri = await this.intuitQB.authorizeUri({
        scope: [OAuthClient.scopes.Accounting, OAuthClient.scopes.OpenId],
        state: JSON.stringify(state),
      })
      return authUri
    } catch (error) {
      throw IntuitOAuthError.fromRaw(error) ?? error
    }
  }

  async _createToken(url: string) {
    try {
      return await this.intuitQB.createToken(url)
    } catch (error) {
      throw IntuitOAuthError.fromRaw(error) ?? error
    }
  }

  async _refreshAccessToken(refreshToken: string) {
    try {
      return await this.intuitQB.refreshUsingToken(refreshToken)
    } catch (error: unknown) {
      throw IntuitOAuthError.fromRaw(error) ?? error
    }
  }

  async getRefreshedQBToken(
    refreshToken: string,
  ): Promise<QBAuthTokenResponse> {
    console.info('Refreshing QuickBooks token...')

    const authResponse = await this.refreshAccessToken(refreshToken)
    const tokenInfo = QBAuthTokenResponseSchema.parse(authResponse.token)
    return tokenInfo
  }

  // `createToken` / `refreshAccessToken` consume single-use credentials with
  // no Intuit-side dedupe; a post-commit retry sees `invalid_grant` and
  // would be misdiagnosed as revocation by `tokenRefresh.handleInvalidGrant`.
  // So the wrapper defaults to strict, same as `IntuitAPI.wrapWithRetry`.
  private wrapWithRetry<Args extends unknown[], R>(
    fn: (...args: Args) => Promise<R>,
    options?: RetryOptions,
  ): (...args: Args) => Promise<R> {
    return (...args: Args): Promise<R> =>
      withRetry(fn.bind(this), args, { idempotent: false, ...options })
  }

  authorizeUri = this.wrapWithRetry(this._authorizeUri)
  refreshAccessToken = this.wrapWithRetry(this._refreshAccessToken)
  createToken = this.wrapWithRetry(this._createToken)
}
