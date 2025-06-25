import APIError from '@/app/api/core/exceptions/api'
import { isAxiosError } from '@/app/api/core/exceptions/custom'
import { BaseService } from '@/app/api/core/services/base.service'
import { AuthStatus } from '@/app/api/core/types/auth'
import { NotificationActions } from '@/app/api/core/types/notification'
import { NotificationService } from '@/app/api/notification/notification.service'
import { LogService } from '@/app/api/quickbooks/log/log.service'
import { SettingService } from '@/app/api/quickbooks/setting/setting.service'
import { SyncService } from '@/app/api/quickbooks/sync/sync.service'
import { TokenService } from '@/app/api/quickbooks/token/token.service'
import { intuitRedirectUri } from '@/config'
import { ConnectionStatus } from '@/db/schema/qbConnectionLogs'
import {
  QBPortalConnection,
  QBPortalConnectionCreateSchemaType,
  QBPortalConnectionUpdateSchemaType,
} from '@/db/schema/qbPortalConnections'
import {
  getPortalConnection,
  getSyncedPortalConnection,
} from '@/db/service/token.service'
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

  async manageIncomeAccountRef(intuitApi: IntuitAPI) {
    const incomeAccRef = await intuitApi.getSingleIncomeAccount()
    return incomeAccRef.Id
  }

  async manageExpenseAccountRef(intuitApi: IntuitAPI) {
    const accName = 'Copilot Processing Fees'
    const existingAccount = await intuitApi.getAnAccountByName(accName)
    if (existingAccount) {
      return existingAccount.Id
    }

    // Docs: https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/account#the-account-object
    const payload = {
      Name: accName,
      Classification: 'Expense',
      AccountType: 'Expense', // Creating expense account.
      AccountSubType: 'FinanceCosts',
      Active: true,
    }
    const expenseAccRef = await intuitApi.createAccount(payload)
    return expenseAccRef.Id
  }

  async manageAssetAccountRef(intuitApi: IntuitAPI) {
    const accName = 'Copilot General Asset'
    const existingAccount = await intuitApi.getAnAccountByName(accName)
    if (existingAccount) {
      return existingAccount.Id
    }

    /**
     * Need to create this account as the source of cash for the company. This account will be referenced while creating a purchase as Expense for absorbed fee.
     * Doc: https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/purchase#create-a-purchase
     * */

    // Docs: https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/account#the-account-object
    const payload = {
      Name: accName,
      Classification: 'Asset',
      AccountType: 'Bank', // Create Bank account. Default account subtype is "CashOnHand".
      Active: true,
    }
    const assetAccRef = await intuitApi.createAccount(payload)
    return assetAccRef.Id
  }

  async storeSettings(portalId: string) {
    const settingsService = new SettingService(this.user)

    const existingSetting = await settingsService.getOneByPortalId(['id'])
    if (!existingSetting) {
      await settingsService.createQBSettings({
        portalId,
      })
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
        syncFlag: true,
        incomeAccountRef: existingToken?.incomeAccountRef || '',
        expenseAccountRef: existingToken?.expenseAccountRef || '',
        assetAccountRef: existingToken?.assetAccountRef || '',
      }
      const intuitApi = new IntuitAPI({
        accessToken: tokenInfo.access_token,
        refreshToken: tokenInfo.refresh_token,
        intuitRealmId: realmId,
        incomeAccountRef: insertPayload.incomeAccountRef,
        expenseAccountRef: insertPayload.expenseAccountRef,
        assetAccountRef: insertPayload.assetAccountRef,
      })
      // manage acc ref from intuit and store in qbPortalConnections table
      if (!insertPayload.incomeAccountRef) {
        insertPayload.incomeAccountRef =
          await this.manageIncomeAccountRef(intuitApi)
      }
      if (!insertPayload.expenseAccountRef) {
        insertPayload.expenseAccountRef =
          await this.manageExpenseAccountRef(intuitApi)
      }
      if (!insertPayload.assetAccountRef) {
        insertPayload.assetAccountRef =
          await this.manageAssetAccountRef(intuitApi)
      }

      const qbTokens = await tokenService.upsertQBPortalConnection(
        insertPayload,
        ['id'],
      )

      if (!qbTokens) {
        throw new APIError(
          httpStatus.INTERNAL_SERVER_ERROR,
          `Cannot create new token for portal ${portalId} and realmId ${realmId}.`,
        )
      }

      // store settings for the portal after successful token exchange
      await this.storeSettings(portalId)

      // store success connection log
      await logService.upsertLatestPendingConnectionLog({
        portalId,
        connectionStatus: ConnectionStatus.SUCCESS,
      })

      after(async () => {
        if (existingToken) {
          console.info('Not initial process. Starting the re-sync process')
          const syncService = new SyncService(this.user)
          await syncService.syncFailedRecords()
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

  async getQBPortalConnection(
    portalId: string,
    manualSyncEnable: boolean = false,
  ): Promise<IntuitAPITokensType> {
    const portalQBToken = await getPortalConnection(portalId)
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
      expenseAccountRef,
      assetAccountRef,
      isEnabled,
      syncFlag,
    } = portalQBToken

    const emptyTokens = {
      accessToken: '',
      refreshToken: '',
      intuitRealmId,
      incomeAccountRef: '',
      expenseAccountRef: '',
      assetAccountRef: '',
    }

    // if sync is false but it has been enabled then don't throw error. We have to log in this case
    if (!syncFlag && (isEnabled || manualSyncEnable)) {
      return emptyTokens
    }

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
      expenseAccountRef,
      assetAccountRef,
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

        const updatedPayload: QBPortalConnectionUpdateSchemaType = {
          accessToken: updatedTokenInfo.accessToken,
          refreshToken: updatedTokenInfo.refreshToken,
          expiresIn: tokenInfo.expires_in,
          XRefreshTokenExpiresIn: tokenInfo.x_refresh_token_expires_in,
          tokenSetTime,
          updatedAt: dayjs().toDate(),
        }

        const whereConditions = and(
          eq(QBPortalConnection.intuitRealmId, intuitRealmId),
          eq(QBPortalConnection.portalId, portalId),
        ) as SQL

        const updateSync = await tokenService.updateQBPortalConnection(
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
          console.error(
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

            return emptyTokens
          }
        }

        throw error
      }
    }
    return updatedTokenInfo
  }
}
