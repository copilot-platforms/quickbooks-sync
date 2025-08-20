import { db } from '@/db'
import { PortalConnectionWithSettingType } from '@/db/schema/qbPortalConnections'
import { QBSettingsSelectSchemaType } from '@/db/schema/qbSettings'
import { WorkspaceResponse } from '@/type/common'
import { CopilotAPI } from '@/utils/copilotAPI'
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

export const getAllPortalConnections = async (): Promise<
  PortalConnectionWithSettingType[]
> => {
  const portals = await db.query.QBPortalConnection.findMany({
    where: (QBPortalConnection) => isNull(QBPortalConnection.deletedAt),
    with: {
      setting: true,
    },
  })

  return portals
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

export const getWorkspaceInfo = async (
  token: string,
): Promise<WorkspaceResponse> => {
  return await new CopilotAPI(token).getWorkspace()
}
