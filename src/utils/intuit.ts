import { withRetry } from '@/app/api/core/utils/withRetry'
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
    // AuthorizationUri
    const authUri = await this.intuitQB.authorizeUri({
      scope: [OAuthClient.scopes.Accounting, OAuthClient.scopes.OpenId],
      state: JSON.stringify(state),
    })
    return authUri
  }

  async _createToken(url: string) {
    return await this.intuitQB.createToken(url)
  }

  async _refreshAccessToken(refreshToken: string) {
    return await this.intuitQB.refreshUsingToken(refreshToken)
  }

  async getRefreshedQBToken(
    refreshToken: string,
  ): Promise<QBAuthTokenResponse> {
    console.log('Refreshing QuickBooks token...')

    const authResponse = await this.refreshAccessToken(refreshToken)
    const tokenInfo = QBAuthTokenResponseSchema.parse(authResponse.token)
    return tokenInfo
  }

  private wrapWithRetry<Args extends unknown[], R>(
    fn: (...args: Args) => Promise<R>,
  ): (...args: Args) => Promise<R> {
    return (...args: Args): Promise<R> => withRetry(fn.bind(this), args)
  }

  authorizeUri = this.wrapWithRetry(this._authorizeUri)
  refreshAccessToken = this.wrapWithRetry(this._refreshAccessToken)
  createToken = this.wrapWithRetry(this._createToken)
}
