import APIError from '@/app/api/core/exceptions/api'
import { BaseService } from '@/app/api/core/services/base.service'
import { AuthStatus } from '@/app/api/core/types/auth'
import { NotificationActions } from '@/app/api/core/types/notification'
import { NotificationService } from '@/app/api/notification/notification.service'
import { LogService } from '@/app/api/quickbooks/log/log.service'
import { SettingService } from '@/app/api/quickbooks/setting/setting.service'
import { SyncService } from '@/app/api/quickbooks/sync/sync.service'
import { TokenService } from '@/app/api/quickbooks/token/token.service'
import { intuitRedirectUri } from '@/config'
import { AccountTypeObj } from '@/constant/qbConnection'
import { ConnectionStatus } from '@/db/schema/qbConnectionLogs'
import { QBPortalConnectionCreateSchemaType } from '@/db/schema/qbPortalConnections'
import { QBSetting } from '@/db/schema/qbSettings'
import {
  getPortalConnection,
  getPortalSettings,
} from '@/db/service/token.service'
import { QBAuthTokenResponseSchema } from '@/type/dto/qbAuthToken.dto'
import Intuit from '@/utils/intuit'
import IntuitAPI, { IntuitAPITokensType } from '@/utils/intuitAPI'
import dayjs from 'dayjs'
import { eq } from 'drizzle-orm'
import httpStatus from 'http-status'
import { afterIfAvailable } from '@/app/api/core/utils/afterIfAvailable'
import {
  getValidQbTokens,
  QBReconnectRequiredError,
} from '@/utils/tokenRefresh'

export class AuthService extends BaseService {
  async getAuthUrl(
    state: { token: string; originUrl?: string },
    type?: string,
  ): Promise<string | null> {
    if (type && type === AuthStatus.RECONNECT) {
      const resStatus = await getPortalSettings(this.user.workspaceId)
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

  async handleAccountReferences(
    intuitApi: IntuitAPI,
    payload: QBPortalConnectionCreateSchemaType,
    tokenService: TokenService,
  ) {
    // manage acc ref from intuit and store in qbPortalConnections table
    const incomeAccountRef = await tokenService.checkAndUpdateAccountStatus(
      AccountTypeObj.Income,
      payload.intuitRealmId,
      intuitApi,
      payload.incomeAccountRef,
    )
    const expenseAccountRef = await tokenService.checkAndUpdateAccountStatus(
      AccountTypeObj.Expense,
      payload.intuitRealmId,
      intuitApi,
      payload.expenseAccountRef,
    )
    const assetAccountRef = await tokenService.checkAndUpdateAccountStatus(
      AccountTypeObj.Asset,
      payload.intuitRealmId,
      intuitApi,
      payload.assetAccountRef,
    )
    return { ...payload, incomeAccountRef, expenseAccountRef, assetAccountRef }
  }

  async storeSettings({
    portalId,
    syncFlag,
  }: {
    portalId: string
    syncFlag: boolean
  }) {
    const settingsService = new SettingService(this.user)

    const existingSetting = await settingsService.getOneByPortalId(['id'])
    if (!existingSetting) {
      await settingsService.createQBSettings({
        portalId,
        syncFlag,
      })
    } else {
      await settingsService.updateQBSettings(
        {
          syncFlag,
        },
        eq(QBSetting.portalId, portalId),
      )
    }
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

      const tokenService = new TokenService(this.user)
      // check if the token exists
      const existingToken = await tokenService.getOneByPortalId(portalId)

      const insertPayload: QBPortalConnectionCreateSchemaType = {
        intuitRealmId: realmId,
        accessToken: tokenInfo.access_token,
        refreshToken: tokenInfo.refresh_token,
        expiresIn: tokenInfo.expires_in,
        XRefreshTokenExpiresIn: tokenInfo.x_refresh_token_expires_in,
        portalId,
        tokenSetTime,
        tokenType: tokenInfo.token_type,
        intiatedBy: this.user.internalUserId as string, // considering this is defined since we know this action is intiated by an IU
        incomeAccountRef: existingToken?.incomeAccountRef || '',
        expenseAccountRef: existingToken?.expenseAccountRef || '',
        assetAccountRef: existingToken?.assetAccountRef || '',
        isSuspended: false, // default value is false when created. Added this for the re-auth case.
      }
      const intuitApi = new IntuitAPI({
        accessToken: tokenInfo.access_token,
        refreshToken: tokenInfo.refresh_token,
        intuitRealmId: realmId,
        incomeAccountRef: insertPayload.incomeAccountRef,
        expenseAccountRef: insertPayload.expenseAccountRef,
        assetAccountRef: insertPayload.assetAccountRef,
        serviceItemRef: existingToken?.serviceItemRef || null,
        clientFeeRef: existingToken?.clientFeeRef || null,
        bankAccountRef: existingToken?.bankAccountRef || null,
      })
      // handle accounts
      const createPayload = await this.handleAccountReferences(
        intuitApi,
        insertPayload,
        tokenService,
      )
      const qbTokens = await tokenService.upsertQBPortalConnection(
        createPayload,
        ['id'],
      )

      if (!qbTokens) {
        throw new APIError(
          httpStatus.INTERNAL_SERVER_ERROR,
          `Cannot create new token for portal ${portalId} and realmId ${realmId}.`,
        )
      }

      // store settings for the portal after successful token exchange
      await this.storeSettings({ portalId, syncFlag: true })

      // store success connection log
      await logService.upsertLatestPendingConnectionLog({
        portalId,
        connectionStatus: ConnectionStatus.SUCCESS,
      })

      afterIfAvailable(async () => {
        if (existingToken) {
          console.info('Not initial process. Starting the re-sync process')
          this.user.qbConnection = {
            serviceItemRef: existingToken.serviceItemRef,
            clientFeeRef: existingToken.clientFeeRef,
          }
          const syncService = new SyncService(this.user)
          await syncService.syncFailedRecords({
            includeNoRetry: true,
          })
        }
      })

      return true
    } catch (error: unknown) {
      console.error('AuthService#handleTokenExchange | Error =', error)
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

  async handleConnectionError(portalId: string) {
    const logService = new LogService(this.user)

    try {
      // store error connection log
      await logService.upsertLatestPendingConnectionLog({
        portalId,
        connectionStatus: ConnectionStatus.ERROR,
      })
    } catch (error: unknown) {
      console.error('AuthService#handleConnectionError | Error =', error)
      throw new APIError(
        httpStatus.INTERNAL_SERVER_ERROR,
        `Something went wrong while handling connection error for portal ${portalId}.`,
      )
    }
  }

  async getQBPortalConnection(
    portalId: string,
    manualSyncEnable: boolean = false,
  ): Promise<IntuitAPITokensType> {
    const portalQBToken = await getPortalConnection(portalId)
    if (!portalQBToken) {
      throw new Error(
        `Synced connection not found for portal with ID: ${portalId}`,
      )
    }

    const { intuitRealmId, setting, isSuspended } = portalQBToken

    if (!setting)
      throw new APIError(
        httpStatus.BAD_REQUEST,
        `Sync setting is not found for portal with ID: ${portalId}`,
      )

    if (isSuspended) throw new Error(`Portal is supended. Id: ${portalId}`)

    const { isEnabled, syncFlag } = setting

    const emptyTokens = {
      accessToken: '',
      refreshToken: '',
      intuitRealmId,
      incomeAccountRef: '',
      expenseAccountRef: '',
      assetAccountRef: '',
      serviceItemRef: '',
      clientFeeRef: '',
      bankAccountRef: null,
    }

    // if sync is false but it has been enabled then don't throw error. We have to log in this case
    if (!syncFlag && (isEnabled || manualSyncEnable)) {
      return emptyTokens
    }

    if (!isEnabled && !manualSyncEnable) {
      throw Error(`Sync is not enabled for portal with ID: ${portalId}`)
    }

    try {
      return await getValidQbTokens(portalId)
    } catch (error: unknown) {
      if (error instanceof QBReconnectRequiredError) {
        console.error(
          `AuthService#getQBPortalConnection | Reconnect required for portalId: ${portalId}. Disabling sync and notifying IU.`,
        )
        // Pair the two side effects: disable sync at the DB level and notify
        // the IU. Queue the notification first so that if `turnOffSync` fails
        // (DB hiccup, etc.) the IU still gets told to reconnect — in that
        // case the next webhook will retry `turnOffSync` through this same
        // catch. `getValidQbTokens` deliberately does not mutate state on
        // revocation; that's our job here where we have a user context.
        afterIfAvailable(async () => {
          const notificationService = new NotificationService(this.user)
          await notificationService.sendNotificationToIU(
            error.intiatedBy ?? '',
            NotificationActions.AUTH_RECONNECT,
          )
        })
        const tokenService = new TokenService(this.user)
        await tokenService.turnOffSync(error.intuitRealmId)
        return emptyTokens
      }
      throw error
    }
  }
}
