import APIError from '@/app/api/core/exceptions/api'
import { isAxiosError } from '@/app/api/core/exceptions/custom'
import { BaseService } from '@/app/api/core/services/base.service'
import { AuthStatus } from '@/app/api/core/types/auth'
import { NotificationActions } from '@/app/api/core/types/notification'
import { NotificationService } from '@/app/api/notification/notification.service'
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
import IntuitAPI, { IntuitAPITokensType } from '@/utils/intuitAPI'
import dayjs from 'dayjs'
import { and, eq, SQL } from 'drizzle-orm'
import httpStatus from 'http-status'
import { after } from 'next/server'

export class AuthService extends BaseService {
  async getAuthUrl(
    state: { token: string; originUrl?: string },
    type?: string,
  ): Promise<string | null> {
    console.log('test redirect url', intuitRedirectUri)
    if (type && type === AuthStatus.RECONNECT) {
      const resStatus = await getSyncedPortalConnection(this.user.workspaceId)
      const status = resStatus?.syncFlag || false
      if (status) return null
    }

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
        syncFlag: true,
        incomeAccountRef: '',
      }

      const tokenService = new TokenService(this.user)
      // set income acc ref here in qbtokens table
      const existingToken = await tokenService.getOneByPortalId(portalId)
      if (!existingToken || !existingToken.incomeAccountRef) {
        // get income acc ref from intuit and store in qbtokens table
        const intuitApi = new IntuitAPI({
          accessToken: tokenInfo.access_token,
          refreshToken: tokenInfo.refresh_token,
          intuitRealmId: realmId,
          incomeAccountRef: '',
        })
        // TODO: implement transactional behavior
        // query income acc ref from intuit
        const incomeAccRef = await intuitApi.getSingleIncomeAccount()
        insertPayload.incomeAccountRef = incomeAccRef.Id
      } else {
        // case for re-authorization
        insertPayload.incomeAccountRef = existingToken.incomeAccountRef // if exists, use existing income account ref
      }

      const qbTokens = await tokenService.upsertQBToken(insertPayload, ['id'])

      if (!qbTokens) {
        throw new APIError(
          httpStatus.INTERNAL_SERVER_ERROR,
          `Cannot create new token for portal ${portalId} and realmId ${realmId}.`,
        )
      }

      // store success connection log
      await logService.upsertLatestPendingConnectionLog({
        portalId,
        connectionStatus: ConnectionStatus.SUCCESS,
      })
      return true
    } catch (error: unknown) {
      console.log('AuthService#handleTokenExchange | Error =', error)
      // store error connection log
      await logService.upsertLatestPendingConnectionLog({
        portalId,
        connectionStatus: ConnectionStatus.ERROR,
      })
      throw new APIError(
        httpStatus.INTERNAL_SERVER_ERROR,
        `Cannot complete token exchange for portal ${portalId}.`,
      )
    }
  }

  async getQBToken(
    portalId: string,
    manualSyncEnable: boolean = false,
  ): Promise<IntuitAPITokensType> {
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
      incomeAccountRef,
      isEnabled,
    } = portalQBToken

    if (!isEnabled && !manualSyncEnable) {
      throw new APIError(
        httpStatus.BAD_REQUEST,
        `Sync is not enabled for portal with ID: ${portalId}`,
      )
    }

    const expiryTime = dayjs(tokenSetTime).add(expiresIn, 'seconds')
    let updatedTokenInfo = {
      accessToken,
      refreshToken,
      intuitRealmId,
      incomeAccountRef,
    }

    // Refresh token if expired
    if (dayjs().isAfter(expiryTime)) {
      const tokenService = new TokenService(this.user)
      try {
        const tokenInfo: QBAuthTokenResponse =
          await Intuit.getInstance().getRefreshedQBToken(refreshToken)
        const tokenSetTime = dayjs().toDate()

        updatedTokenInfo = {
          ...updatedTokenInfo,
          accessToken: tokenInfo.access_token,
          refreshToken: tokenInfo.refresh_token,
        }

        const updatedPayload: QBTokenUpdateSchemaType = {
          accessToken: updatedTokenInfo.accessToken,
          refreshToken: updatedTokenInfo.refreshToken,
          expiresIn: tokenInfo.expires_in,
          XRefreshTokenExpiresIn: tokenInfo.x_refresh_token_expires_in,
          tokenSetTime,
          updatedAt: dayjs().toDate(),
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
            await tokenService.turnOffSync(intuitRealmId)

            // send notification to IU
            after(async () => {
              const notificationService = new NotificationService(this.user)
              await notificationService.sendNotificationToIU(
                intiatedBy,
                NotificationActions.AUTH_RECONNECT,
              )
            })

            return {
              accessToken: '',
              refreshToken: '',
              intuitRealmId,
              incomeAccountRef: '',
            }
          }
        }

        throw error
      }
    }
    return updatedTokenInfo
  }
}
