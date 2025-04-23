import { BaseService } from '@/app/api/core/services/base.service'
import { intuitRedirectUri } from '@/config'
import {
  QBTokens,
  QBTokenCreateSchema,
  QBTokenCreateSchemaType,
} from '@/db/schema/qbTokens'
import { QBAuthTokenResponseSchema } from '@/type/dto/qbAuthToken.dto'
import Intuit from '@/utils/intuit'

export class AuthService extends BaseService {
  async getAuthUrl(state: { token: string; originUrl?: string }) {
    const authUri = await Intuit.getInstance().authorizeUri(state)
    return authUri
  }

  async createQBToken(payload: QBTokenCreateSchemaType) {
    const parsedInsertPayload = QBTokenCreateSchema.parse(payload)

    await this.db.insert(QBTokens).values(parsedInsertPayload)
  }

  async handleTokenExchange(
    body: { code: string; realmId: string },
    portalId: string,
  ): Promise<boolean> {
    const { code, realmId } = body
    const requestUrl = `${intuitRedirectUri}?code=${code}&realmId=${realmId}`
    const authResponse = await Intuit.getInstance().createToken(requestUrl) // exchange authorization code for access token
    const tokenInfo = QBAuthTokenResponseSchema.parse(authResponse.token)

    const insertPayload: QBTokenCreateSchemaType = {
      intuitRealmId: realmId,
      accessToken: tokenInfo.access_token,
      refreshToken: tokenInfo.refresh_token,
      expiresIn: tokenInfo.expires_in,
      XRefreshTokenExpiresIn: tokenInfo.x_refresh_token_expires_in,
      portalId,
      syncFlag: true,
    }

    await this.createQBToken(insertPayload)

    return true
  }
}
