import { BaseService } from '@/app/api/core/services/base.service'
import { buildReturningFields } from '@/db/helper/drizzle.helper'
import {
  QBSetting,
  QBSettingCreateSchema,
  QBSettingCreateSchemaType,
  QBSettingsSelectSchemaType,
  QBSettingsUpdateSchema,
  QBSettingsUpdateSchemaType,
} from '@/db/schema/qbSettings'
import { WhereClause } from '@/type/common'
import dayjs from 'dayjs'

export class SettingService extends BaseService {
  async getOneByPortalId(
    returningFields?: (keyof typeof QBSetting)[],
  ): Promise<Partial<QBSettingsSelectSchemaType> | undefined> {
    let columns = null
    if (returningFields?.length) {
      columns = buildReturningFields(QBSetting, returningFields, true)
    }

    return await this.db.query.QBSetting.findFirst({
      where: (QBSetting, { eq }) =>
        eq(QBSetting.portalId, this.user.workspaceId),
      ...(columns && { columns }),
    })
  }

  async createQBSettings(
    payload: QBSettingCreateSchemaType,
  ): Promise<QBSettingsSelectSchemaType> {
    console.info(
      'SettingService#createQBSettings | Create settings for the portal Id = ',
      payload.portalId,
    )
    const parsedInsertPayload = QBSettingCreateSchema.parse(payload)
    const [setting] = await this.db
      .insert(QBSetting)
      .values(parsedInsertPayload)

    console.info('SettingService#createQBSettings | settings created')
    return setting
  }

  async updateQBSettings(
    payload: QBSettingsUpdateSchemaType,
    conditions: WhereClause,
  ): Promise<QBSettingsSelectSchemaType> {
    const parsedInsertPayload = QBSettingsUpdateSchema.parse(payload)

    const [setting] = await this.db
      .update(QBSetting)
      .set({ ...parsedInsertPayload, updatedAt: dayjs().toDate() })
      .where(conditions)
      .returning()

    return setting
  }
}
