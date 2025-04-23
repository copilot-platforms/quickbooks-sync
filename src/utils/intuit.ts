import {
  intuitClientId,
  intuitClientSecret,
  intuitEnvironment,
  intuitRedirectUri,
} from '@/config'
import OAuthClient from 'intuit-oauth'

export default class Intuit {
  private static instance: Intuit
  private intuitQB: typeof OAuthClient

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

  public static getInstance() {
    if (!Intuit.instance) {
      Intuit.instance = new Intuit()
    }
    return Intuit.instance
  }

  public async authorizeUri(state: { token: string; originUrl?: string }) {
    // AuthorizationUri
    const authUri = await this.intuitQB.authorizeUri({
      scope: [OAuthClient.scopes.Accounting, OAuthClient.scopes.OpenId],
      state: JSON.stringify(state),
    })
    return authUri
  }

  public async createToken(url: string) {
    return await this.intuitQB.createToken(url)
  }
}
