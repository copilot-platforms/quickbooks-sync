import APIError from '@/app/api/core/exceptions/api'
import { isAxiosError } from '@/app/api/core/exceptions/custom'
import { BaseService } from '@/app/api/core/services/base.service'
import { LogService } from '@/app/api/quickbooks/log/log.service'
import { TokenService } from '@/app/api/quickbooks/token/token.service'
import { intuitRedirectUri } from '@/config'
import { ConnectionStatus } from '@/db/schema/qbConnectionLogs'
import {
  QBTokens,
  QBTokenCreateSchemaType,
  QBTokenUpdateSchemaType,
} from '@/db/schema/qbTokens'
import { getSyncedPortalConnection } from '@/db/service/token.service'
import {
  QBAuthTokenResponse,
  QBAuthTokenResponseSchema,
} from '@/type/dto/qbAuthToken.dto'
import Intuit from '@/utils/intuit'
import dayjs from 'dayjs'
import { and, eq, SQL } from 'drizzle-orm'
import httpStatus from 'http-status'
export class AuthService extends BaseService {
  async getAuthUrl(state: { token: string; originUrl?: string }) {
    const logService = new LogService(this.user)
    await logService.storeConnectionLog({
      portalId: this.user.workspaceId,
      connectionStatus: ConnectionStatus.PENDING,
    })
    return await Intuit.getInstance().authorizeUri(state)
  }

  async handleTokenExchange(
    body: { code: string; realmId: string },
    portalId: string,
  ): Promise<boolean> {
    const logService = new LogService(this.user)
    try {
      const { code, realmId } = body
      const requestUrl = `${intuitRedirectUri}?code=${code}&realmId=${realmId}`
      const authResponse = await Intuit.getInstance().createToken(requestUrl) // exchange authorization code for access token
      const tokenInfo = QBAuthTokenResponseSchema.parse(authResponse.token)
      const tokenSetTime = dayjs().toDate()

      const insertPayload: QBTokenCreateSchemaType = {
        intuitRealmId: realmId,
        accessToken: tokenInfo.access_token,
        refreshToken: tokenInfo.refresh_token,
        expiresIn: tokenInfo.expires_in,
        XRefreshTokenExpiresIn: tokenInfo.x_refresh_token_expires_in,
        portalId,
        tokenSetTime,
        tokenType: tokenInfo.token_type,
        intiatedBy: this.user.internalUserId as string, // considering this is defined since we know this action is intiated by an IU
      }

      const tokenService = new TokenService(this.user)
      const qbTokens = await tokenService.createQBToken(insertPayload, ['id'])

      if (!qbTokens) {
        throw new APIError(
          httpStatus.INTERNAL_SERVER_ERROR,
          `Cannot create new token for portal ${portalId} and realmId ${realmId}.`,
        )
      }

      // store success connection log
      await logService.upsertConnectionLog({
        portalId,
        connectionStatus: ConnectionStatus.SUCCESS,
      })
      return true
    } catch (error: unknown) {
      // store error connection log
      await logService.upsertConnectionLog({
        portalId,
        connectionStatus: ConnectionStatus.ERROR,
      })
      throw new APIError(
        httpStatus.INTERNAL_SERVER_ERROR,
        `Cannot complete token exchange for portal ${portalId}.`,
      )
    }
  }

  async getQBAccessToken(portalId: string): Promise<string | null> {
    const portalQBToken = await getSyncedPortalConnection(portalId)
    if (!portalQBToken) {
      throw new APIError(
        httpStatus.NOT_FOUND,
        `Synced connection not found for portal with ID: ${portalId}`,
      )
    }

    const {
      accessToken,
      refreshToken,
      tokenSetTime,
      intuitRealmId,
      intiatedBy,
      expiresIn,
    } = portalQBToken
    const expiryTime = dayjs(tokenSetTime).add(expiresIn, 'seconds')
    let updatedAccessToken = accessToken

    // Refresh token if expired
    if (dayjs().isAfter(expiryTime)) {
      const tokenService = new TokenService(this.user)
      try {
        const tokenInfo: QBAuthTokenResponse =
          await Intuit.getInstance().getRefreshedQBToken(refreshToken)
        const tokenSetTime = dayjs().toDate()

        updatedAccessToken = tokenInfo.access_token

        const updatedPayload: QBTokenUpdateSchemaType = {
          accessToken: updatedAccessToken,
          refreshToken: tokenInfo.refresh_token,
          expiresIn: tokenInfo.expires_in,
          XRefreshTokenExpiresIn: tokenInfo.x_refresh_token_expires_in,
          tokenSetTime,
          updatedAt: new Date(),
        }

        const whereConditions = and(
          eq(QBTokens.intuitRealmId, intuitRealmId),
          eq(QBTokens.portalId, portalId),
        ) as SQL

        const updateSync = await tokenService.updateQBToken(
          updatedPayload,
          whereConditions,
          ['id'],
        )

        if (!updateSync) {
          throw new APIError(
            httpStatus.INTERNAL_SERVER_ERROR,
            `Cannot update sync status for portal ${portalId} and realmId ${intuitRealmId}.`,
          )
        }
      } catch (error: unknown) {
        if (isAxiosError(error)) {
          // Special handling for refresh token expired
          console.log(
            'Refresh token is invalid or expired, reauthorization needed.',
            { message: error.response.data?.error },
          )

          if (error.response.data?.error === 'invalid_grant') {
            // indicates that the refresh token is invalid
            // turn off the sync and send notifications to IU (product and email)
            await tokenService.turnOffSyncAndSendNotificationToIU(
              intuitRealmId,
              intiatedBy,
            )

            throw new APIError(
              httpStatus.UNAUTHORIZED,
              'Refresh token is invalid or expired, reauthorization needed.',
            )
          }
        }

        throw error
      }
    }
    return updatedAccessToken
  }
}
