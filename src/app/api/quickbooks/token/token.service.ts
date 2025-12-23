import APIError from '@/app/api/core/exceptions/api'
import { BaseService } from '@/app/api/core/services/base.service'
import { SettingService } from '@/app/api/quickbooks/setting/setting.service'
import { AccountTypeObj } from '@/constant/qbConnection'
import { buildReturningFields } from '@/db/helper/drizzle.helper'
import {
  QBPortalConnectionCreateSchema,
  QBPortalConnectionCreateSchemaType,
  QBPortalConnection,
  QBPortalConnectionSelectSchemaType,
  QBPortalConnectionUpdateSchema,
  QBPortalConnectionUpdateSchemaType,
} from '@/db/schema/qbPortalConnections'
import { QBSetting, QBSettingsUpdateSchemaType } from '@/db/schema/qbSettings'
import { getPortalConnection } from '@/db/service/token.service'
import { AccountType, ChangeEnableStatusRequestType } from '@/type/common'
import IntuitAPI from '@/utils/intuitAPI'
import CustomLogger from '@/utils/logger'
import dayjs from 'dayjs'
import { and, eq, SQL } from 'drizzle-orm'
import httpStatus from 'http-status'

type WhereClause = SQL<unknown>

export class TokenService extends BaseService {
  async getOneByPortalId(
    portalId: string,
  ): Promise<QBPortalConnectionSelectSchemaType | null> {
    const portalConnection = await getPortalConnection(portalId)

    return portalConnection
  }

  async createQBPortalConnection(
    payload: QBPortalConnectionCreateSchemaType,
    returningFields?: (keyof typeof QBPortalConnection)[],
  ) {
    const parsedInsertPayload = QBPortalConnectionCreateSchema.parse(payload)
    const query = this.db.insert(QBPortalConnection).values(parsedInsertPayload)

    const [token] = returningFields?.length
      ? await query.returning(
          buildReturningFields(QBPortalConnection, returningFields),
        )
      : await query.returning()

    return token
  }

  async upsertQBPortalConnection(
    payload: QBPortalConnectionCreateSchemaType,
    returningFields?: (keyof typeof QBPortalConnection)[],
  ) {
    const parsedInsertPayload = QBPortalConnectionCreateSchema.parse(payload)
    const query = this.db
      .insert(QBPortalConnection)
      .values(parsedInsertPayload)
      .onConflictDoUpdate({
        target: QBPortalConnection.portalId,
        set: { ...parsedInsertPayload, updatedAt: dayjs().toDate() },
      })

    const [token] = returningFields?.length
      ? await query.returning(
          buildReturningFields(QBPortalConnection, returningFields),
        )
      : await query.returning()

    return token
  }

  async updateQBPortalConnection(
    payload: QBPortalConnectionUpdateSchemaType,
    conditions: WhereClause,
    returningFields?: (keyof typeof QBPortalConnection)[],
  ) {
    const parsedInsertPayload = QBPortalConnectionUpdateSchema.parse(payload)

    const query = this.db
      .update(QBPortalConnection)
      .set(parsedInsertPayload)
      .where(conditions)

    const [token] = returningFields?.length
      ? await query.returning(
          buildReturningFields(QBPortalConnection, returningFields),
        )
      : await query.returning()

    return token
  }

  async turnOffSync(intuitRealmId: string) {
    const portalId = this.user.workspaceId
    // update db sync status for the defined portal
    const whereConditions = eq(QBSetting.portalId, portalId)

    const updateSyncPayload: QBSettingsUpdateSchemaType = {
      syncFlag: false,
    }

    const settingService = new SettingService(this.user)
    const updateSync = await settingService.updateQBSettings(
      updateSyncPayload,
      whereConditions,
    )

    if (!updateSync) {
      throw new APIError(
        httpStatus.INTERNAL_SERVER_ERROR,
        `Cannot update sync status for portal ${portalId} and realmId ${intuitRealmId}.`,
      )
    }
    return updateSync
  }

  async changeEnableStatus(
    portalId: string,
    parsedBody: ChangeEnableStatusRequestType,
  ) {
    const whereConditions = and(
      eq(QBSetting.portalId, portalId),
      eq(QBSetting.syncFlag, true),
    ) as SQL

    const settingService = new SettingService(this.user)
    const portal = await settingService.updateQBSettings(
      {
        isEnabled: parsedBody.enable,
      },
      whereConditions,
    )

    if (!portal) {
      throw new APIError(
        httpStatus.BAD_REQUEST,
        `Cannot update sync status for portal ${portalId}.`,
      )
    }
    return portal
  }

  private async removeAccountMapping(
    accountType: AccountType,
    realmId: string,
  ) {
    let payload = {}
    switch (accountType) {
      case AccountTypeObj.Income:
        payload = {
          incomeAccountRef: '',
        }
        break
      case AccountTypeObj.Expense:
        payload = {
          expenseAccountRef: '',
        }
        break
      case AccountTypeObj.Asset:
        payload = {
          assetAccountRef: '',
        }
        break
      default:
        throw new APIError(
          httpStatus.BAD_REQUEST,
          `Cannot remove account mapping for account type ${accountType}`,
        )
    }
    await this.updateQBPortalConnection(
      payload,
      and(
        eq(QBPortalConnection.portalId, this.user.workspaceId),
        eq(QBPortalConnection.intuitRealmId, realmId),
      ) as WhereClause,
    )
  }

  async checkAndUpdateAccountStatus(
    accountType: AccountType,
    realmId: string,
    intuitApi: IntuitAPI,
    accountId?: string,
  ) {
    if (!accountId) return

    console.info(
      'TokenService#checkAndUpdateAccountStatus. Updating account status ...',
    )

    // 1. get account by ID
    let account = await intuitApi.getAnAccount(undefined, accountId, true)

    CustomLogger.info({
      obj: { account },
      message:
        'TokenService#checkAndUpdateAccountStatus. Account query response',
    })

    // if no account found, remove mapping
    if (!account) {
      console.info(
        `TokenService#checkAndUpdateAccountStatus. Account not found for Id ${accountId} in QuickBooks. Unmapping the account...`,
      )
      await this.removeAccountMapping(accountType, realmId)
      return
    } else if (!account.Active) {
      console.info(
        `TokenService#checkAndUpdateAccountStatus. Account with Id ${accountId} is inactive. Making it active...`,
      )
      // if item is inactive, make it active
      const updateRes = await intuitApi.updateAccount({
        Id: account.Id,
        Name: account.Name,
        SyncToken: account.SyncToken,
        Active: true,
        sparse: true,
      })
      account = updateRes.Account

      CustomLogger.info({
        obj: { account },
        message:
          'TokenService#checkAndUpdateAccountStatus. Account made active.',
      })
    }

    return account.Id
  }
}
