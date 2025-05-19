import APIError from '@/app/api/core/exceptions/api'
import { BaseService } from '@/app/api/core/services/base.service'
import { buildReturningFields } from '@/db/helper/drizzle.helper'
import {
  QBTokenCreateSchema,
  QBTokenCreateSchemaType,
  QBTokens,
  QBTokenSelectSchemaType,
  QBTokenUpdateSchema,
  QBTokenUpdateSchemaType,
} from '@/db/schema/qbTokens'
import { getPortalConnection } from '@/db/service/token.service'
import dayjs from 'dayjs'
import { and, eq, SQL } from 'drizzle-orm'
import httpStatus from 'http-status'

type WhereClause = SQL<unknown>

export class TokenService extends BaseService {
  async getOneByPortalId(
    portalId: string,
  ): Promise<QBTokenSelectSchemaType | null> {
    const portalConnection = await getPortalConnection(portalId)

    return portalConnection
  }

  async createQBToken(
    payload: QBTokenCreateSchemaType,
    returningFields?: (keyof typeof QBTokens)[],
  ) {
    const parsedInsertPayload = QBTokenCreateSchema.parse(payload)
    const query = this.db.insert(QBTokens).values(parsedInsertPayload)

    const [token] =
      returningFields && returningFields.length > 0
        ? await query.returning(buildReturningFields(QBTokens, returningFields))
        : await query.returning()

    return token
  }

  async upsertQBToken(
    payload: QBTokenCreateSchemaType,
    returningFields?: (keyof typeof QBTokens)[],
  ) {
    const parsedInsertPayload = QBTokenCreateSchema.parse(payload)
    const query = this.db
      .insert(QBTokens)
      .values(parsedInsertPayload)
      .onConflictDoUpdate({
        target: QBTokens.portalId,
        set: { ...parsedInsertPayload, updatedAt: dayjs().toDate() },
      })

    const [token] =
      returningFields && returningFields.length > 0
        ? await query.returning(buildReturningFields(QBTokens, returningFields))
        : await query.returning()

    return token
  }

  async updateQBToken(
    payload: QBTokenUpdateSchemaType,
    conditions: WhereClause,
    returningFields?: (keyof typeof QBTokens)[],
  ) {
    const parsedInsertPayload = QBTokenUpdateSchema.parse(payload)

    const query = this.db
      .update(QBTokens)
      .set(parsedInsertPayload)
      .where(conditions)

    const [token] =
      returningFields && returningFields.length > 0
        ? await query.returning(buildReturningFields(QBTokens, returningFields))
        : await query.returning()

    return token
  }

  async turnOffSync(intuitRealmId: string) {
    const portalId = this.user.workspaceId
    // update db sync status for the defined portal
    const whereConditions = and(
      eq(QBTokens.intuitRealmId, intuitRealmId),
      eq(QBTokens.portalId, portalId),
    ) as SQL

    const updateSyncPayload: QBTokenUpdateSchemaType = {
      syncFlag: false,
    }

    const tokenService = new TokenService(this.user)
    const updateSync = await tokenService.updateQBToken(
      updateSyncPayload,
      whereConditions,
      ['id'],
    )

    if (!updateSync) {
      throw new APIError(
        httpStatus.INTERNAL_SERVER_ERROR,
        `Cannot update sync status for portal ${portalId} and realmId ${intuitRealmId}.`,
      )
    }
    return updateSync
  }
}
