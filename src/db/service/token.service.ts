import { db } from '@/db'
import { PortalConnectionWithSettingType } from '@/db/schema/qbPortalConnections'
import { QBSettingsSelectSchemaType } from '@/db/schema/qbSettings'
import { and, isNull } from 'drizzle-orm'

export const getPortalConnection = async (
  portalId: string,
): Promise<PortalConnectionWithSettingType | null> => {
  const portalSync = await db.query.QBPortalConnection.findFirst({
    where: (QBPortalConnection, { eq }) =>
      and(
        isNull(QBPortalConnection.deletedAt),
        eq(QBPortalConnection.portalId, portalId),
      ),
    with: {
      setting: true,
    },
  })

  return portalSync || null
}

export const getPortalSettings = async (
  portalId: string,
): Promise<QBSettingsSelectSchemaType | null> => {
  const portalSync = await db.query.QBSetting.findFirst({
    where: (QBSetting, { eq }) =>
      and(eq(QBSetting.portalId, portalId), eq(QBSetting.syncFlag, true)),
  })

  return portalSync || null
}
