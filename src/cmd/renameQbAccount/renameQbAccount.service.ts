import { BaseService } from '@/app/api/core/services/base.service'
import { TokenService } from '@/app/api/quickbooks/token/token.service'
import {
  PortalConnectionWithSettingType,
  QBPortalConnection,
  QBPortalConnectionUpdateSchemaType,
} from '@/db/schema/qbPortalConnections'
import { getAllActivePortalConnections } from '@/db/service/token.service'
import Intuit from '@/utils/intuit'
import IntuitAPI from '@/utils/intuitAPI'
import CustomLogger from '@/utils/logger'
import dayjs from 'dayjs'
import { and, eq, SQL } from 'drizzle-orm'

const assetAccountNameOld = 'Copilot General Asset'
const assetAccountNameNew = 'Assembly General Asset'

const expenseAccountNameOld = 'Copilot Processing Fees'
const expenseAccountNameNew = 'Assembly Processing Fees'

const clientFeeOld = 'Copilot Fees paid by Client'
const clientFeeNew = 'Assembly Fees paid by Client'

export class RenameQbAccountService extends BaseService {
  private static connection: PortalConnectionWithSettingType

  async renameQbAccountName() {
    // 1. get all the active portals
    const portals = await getAllActivePortalConnections()

    // 2. refresh the token for the active portal and store in db
    for (const portal of portals) {
      if (
        !portal.assetAccountRef &&
        !portal.expenseAccountRef &&
        !portal.clientFeeRef
      ) {
        console.info('No account ref for portal: ' + JSON.stringify(portal))
        continue
      }
      console.info('... Processing portal: ' + JSON.stringify(portal))

      RenameQbAccountService.connection = portal
      await this.processAccountRename()
    }

    console.info('RenameQbAccountService#renameQbAccountName | Finished')
  }

  async processAccountRename() {
    const portal = RenameQbAccountService.connection
    const qbTokenInfo = {
      accessToken: portal.accessToken,
      refreshToken: portal.refreshToken,
      intuitRealmId: portal.intuitRealmId,
      incomeAccountRef: portal.incomeAccountRef,
      expenseAccountRef: portal.expenseAccountRef,
      assetAccountRef: portal.assetAccountRef,
      serviceItemRef: portal.serviceItemRef,
      clientFeeRef: portal.clientFeeRef,
    }
    const intuitApi = new IntuitAPI(qbTokenInfo)
    await this.handleRefreshToken()

    let renameAssetAccount, renameExpenseAccount, renameClientFeeAccount

    if (portal.assetAccountRef)
      renameAssetAccount = this.renameAccount(
        intuitApi,
        assetAccountNameOld,
        assetAccountNameNew,
      )

    if (portal.expenseAccountRef)
      renameExpenseAccount = this.renameAccount(
        intuitApi,
        expenseAccountNameOld,
        expenseAccountNameNew,
      )

    if (portal.clientFeeRef)
      renameClientFeeAccount = this.renameClientFeeAccount(intuitApi)

    await Promise.all([
      renameAssetAccount,
      renameExpenseAccount,
      renameClientFeeAccount,
    ])
  }

  private async renameAccount(
    intuitApi: IntuitAPI,
    oldName: string,
    newName: string,
  ) {
    try {
      const portal = RenameQbAccountService.connection
      const existingAccount = await intuitApi.getAnAccount(
        oldName,
        undefined,
        true,
      )
      if (!existingAccount) {
        CustomLogger.info({
          message: `RenameQbAccountService#renameAssetAccount | No existing account found with name ${oldName}`,
          obj: { portalId: portal.portalId },
        })
        return
      }

      const payload = {
        Id: existingAccount.Id,
        Name: newName,
        SyncToken: existingAccount.SyncToken,
        sparse: true,
        Active: true,
      }
      await intuitApi.updateAccount(payload)
    } catch (error: unknown) {
      CustomLogger.error({
        message: 'RenameQbAccountService#renameAccount',
        obj: { error },
      })
    }
  }

  private async renameClientFeeAccount(intuitApi: IntuitAPI) {
    try {
      const existingItem = await intuitApi.getAnItem(
        clientFeeOld,
        undefined,
        true,
      )
      if (!existingItem) {
        CustomLogger.info({
          message: `RenameQbAccountService#renameClientFeeAccount | No existing item found with name ${clientFeeOld}`,
          obj: { portalId: RenameQbAccountService.connection.portalId },
        })
        return
      }

      const payload = {
        Id: existingItem.Id,
        Name: clientFeeNew,
        SyncToken: existingItem.SyncToken,
        sparse: true,
        Active: true,
      }
      await intuitApi.itemFullUpdate(payload)
    } catch (error: unknown) {
      CustomLogger.error({
        message: 'RenameQbAccountService#renameClientFeeAccount',
        obj: { error },
      })
    }
  }

  private async handleRefreshToken() {
    try {
      const portal = RenameQbAccountService.connection
      const tokenInfo = await Intuit.getInstance().getRefreshedQBToken(
        portal.refreshToken,
      )

      const updatedPayload: QBPortalConnectionUpdateSchemaType = {
        accessToken: tokenInfo.access_token,
        refreshToken: tokenInfo.refresh_token,
        expiresIn: tokenInfo.expires_in,
        XRefreshTokenExpiresIn: tokenInfo.x_refresh_token_expires_in,
        tokenSetTime: dayjs().toDate(),
      }

      const whereConditions = and(
        eq(QBPortalConnection.intuitRealmId, portal.intuitRealmId),
        eq(QBPortalConnection.portalId, portal.portalId),
      ) as SQL

      const tokenService = new TokenService(this.user)
      await tokenService.updateQBPortalConnection(
        updatedPayload,
        whereConditions,
        ['id'],
      )
      console.info('Access token refreshed and updated in DB 🔥')
    } catch (error: unknown) {
      console.error('Issue while refreshing token')
      CustomLogger.error({
        message: 'RenameQbAccountService#handleRefreshToken',
        obj: { error },
      })
    }
  }
}
