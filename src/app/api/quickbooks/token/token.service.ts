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
import {
  getPortalConnection,
  getPortalTokens,
} from '@/db/service/token.service'
import {
  AccountRefsUpdateSchema,
  AccountRefsUpdateType,
  AccountType,
  ChangeEnableStatusRequestType,
} from '@/type/common'
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

  async updateAccountRefs(payload: AccountRefsUpdateType) {
    const parsed = AccountRefsUpdateSchema.parse(payload)

    let tokens
    try {
      tokens = await getPortalTokens(this.user.workspaceId)
    } catch {
      throw new APIError(
        httpStatus.NOT_FOUND,
        'TokenService#updateAccountRefs | no portal connection',
      )
    }

    const intuitApi = new IntuitAPI(tokens)

    const checks: Array<[keyof AccountRefsUpdateType, (t: string) => boolean]> =
      []
    if (parsed.incomeAccountRef)
      checks.push(['incomeAccountRef', (t) => t === 'Income'])
    if (parsed.expenseAccountRef)
      checks.push(['expenseAccountRef', (t) => t === 'Expense'])
    if (parsed.assetAccountRef)
      checks.push(['assetAccountRef', (t) => t === 'Bank'])

    await Promise.all(
      checks.map(async ([field, isValidType]) => {
        const id = parsed[field]!
        const account = await intuitApi.getAnAccount(undefined, id)
        if (!account) {
          throw new APIError(
            httpStatus.BAD_REQUEST,
            `${field} account not found`,
          )
        }
        const acctType = account.AccountType
        if (!isValidType(acctType)) {
          throw new APIError(
            httpStatus.BAD_REQUEST,
            `${field} has an incompatible account type`,
          )
        }
      }),
    )

    return await this.updateQBPortalConnection(
      parsed,
      eq(QBPortalConnection.portalId, this.user.workspaceId),
    )
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

  private async updateAccountMapping(
    accountType: AccountType,
    realmId: string,
    accountRef: string,
  ) {
    let payload: QBPortalConnectionUpdateSchemaType = {}
    switch (accountType) {
      case AccountTypeObj.Income:
        payload = { incomeAccountRef: accountRef }
        break
      case AccountTypeObj.Expense:
        payload = { expenseAccountRef: accountRef }
        break
      case AccountTypeObj.Asset:
        payload = { assetAccountRef: accountRef }
        break
      default:
        throw new APIError(
          httpStatus.BAD_REQUEST,
          `Cannot update account mapping for account type ${accountType}`,
        )
    }
    const updated = await this.updateQBPortalConnection(
      payload,
      and(
        eq(QBPortalConnection.portalId, this.user.workspaceId),
        eq(QBPortalConnection.intuitRealmId, realmId),
      ) as WhereClause,
    )
    if (!updated) {
      console.error(
        `TokenService#updateAccountMapping | No row updated for portalId=${this.user.workspaceId} realmId=${realmId}. Account ref may be stale in DB.`,
      )
    }
  }

  private async getOrCreateIncomeAccountRef(
    intuitApi: IntuitAPI,
  ): Promise<string> {
    const existingIncomeAccRef = await intuitApi.getSingleIncomeAccount()
    if (existingIncomeAccRef?.Id) {
      return existingIncomeAccRef.Id
    }

    console.info(
      'TokenService#getOrCreateIncomeAccountRef | No existing income account found. Creating new one.',
    )

    const payload = {
      Name: 'Assembly SOP Income',
      Classification: 'Revenue',
      AccountType: 'Income',
      AccountSubType: 'SalesOfProductIncome',
      Active: true,
    }
    const incomeAccRef = await intuitApi.createAccount(payload)
    if (!incomeAccRef?.Id) {
      throw new APIError(
        httpStatus.INTERNAL_SERVER_ERROR,
        'TokenService#getOrCreateIncomeAccountRef | Created account has no Id',
      )
    }
    return incomeAccRef.Id
  }

  private async getOrCreateExpenseAccountRef(
    intuitApi: IntuitAPI,
  ): Promise<string> {
    const accName = 'Assembly Processing Fees'
    const existingAccount = await intuitApi.getAnAccount(accName)
    if (existingAccount?.Id) {
      return existingAccount.Id
    }

    console.info(
      'TokenService#getOrCreateExpenseAccountRef | No existing expense account found. Creating new one.',
    )

    const payload = {
      Name: accName,
      Classification: 'Expense',
      AccountType: 'Expense',
      AccountSubType: 'FinanceCosts',
      Active: true,
    }
    const expenseAccRef = await intuitApi.createAccount(payload)
    if (!expenseAccRef?.Id) {
      throw new APIError(
        httpStatus.INTERNAL_SERVER_ERROR,
        'TokenService#getOrCreateExpenseAccountRef | Created account has no Id',
      )
    }
    return expenseAccRef.Id
  }

  private async getOrCreateAssetAccountRef(
    intuitApi: IntuitAPI,
  ): Promise<string> {
    const accName = 'Assembly General Asset'
    const existingAccount = await intuitApi.getAnAccount(accName)
    if (existingAccount?.Id) {
      return existingAccount.Id
    }

    console.info(
      'TokenService#getOrCreateAssetAccountRef | No existing asset account found. Creating new one.',
    )

    // Need to create this account as the source of cash for the company. This account will be referenced while creating a purchase as Expense for absorbed fee.
    // Docs: https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/account#the-account-object
    const payload = {
      Name: accName,
      Classification: 'Asset',
      AccountType: 'Bank', // Create Bank account. Default account subtype is "CashOnHand".
      Active: true,
    }
    const assetAccRef = await intuitApi.createAccount(payload)
    if (!assetAccRef?.Id) {
      throw new APIError(
        httpStatus.INTERNAL_SERVER_ERROR,
        'TokenService#getOrCreateAssetAccountRef | Created account has no Id',
      )
    }
    return assetAccRef.Id
  }

  private async restoreAccountRef(
    accountType: AccountType,
    intuitApi: IntuitAPI,
  ): Promise<string> {
    switch (accountType) {
      case AccountTypeObj.Income:
        return this.getOrCreateIncomeAccountRef(intuitApi)
      case AccountTypeObj.Expense:
        return this.getOrCreateExpenseAccountRef(intuitApi)
      case AccountTypeObj.Asset:
        return this.getOrCreateAssetAccountRef(intuitApi)
      default:
        throw new APIError(
          httpStatus.BAD_REQUEST,
          `Cannot restore account ref for account type ${accountType}`,
        )
    }
  }

  async checkAndUpdateAccountStatus(
    accountType: AccountType,
    realmId: string,
    intuitApi: IntuitAPI,
    accountId?: string,
  ): Promise<string> {
    if (!accountId) {
      console.info(
        `TokenService#checkAndUpdateAccountStatus. No accountId provided for ${accountType}. Restoring account ref...`,
      )
      const restoredRef = await this.restoreAccountRef(accountType, intuitApi)
      await this.updateAccountMapping(accountType, realmId, restoredRef)
      console.info(
        `TokenService#checkAndUpdateAccountStatus. Restored ${accountType} account ref to ${restoredRef}.`,
      )
      return restoredRef
    }

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

    // if no account found, restore account ref
    if (!account) {
      console.info(
        `TokenService#checkAndUpdateAccountStatus. Account not found for Id ${accountId} in QuickBooks. Restoring account ref...`,
      )
      const restoredRef = await this.restoreAccountRef(accountType, intuitApi)
      await this.updateAccountMapping(accountType, realmId, restoredRef)
      console.info(
        `TokenService#checkAndUpdateAccountStatus. Restored ${accountType} account ref to ${restoredRef}.`,
      )
      return restoredRef
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
