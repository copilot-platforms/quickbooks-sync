'use server'
import { db } from '@/db'
import { PortalConnectionWithSettingType } from '@/db/schema/qbPortalConnections'
import { QBSettingsSelectSchemaType } from '@/db/schema/qbSettings'
import { WorkspaceResponse } from '@/type/common'
import { CopilotAPI } from '@/utils/copilotAPI'
import { IntuitAPITokensType } from '@/utils/intuitAPI'
import { and, eq, isNull } from 'drizzle-orm'

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

export const getAllActivePortalConnections = async (): Promise<
  PortalConnectionWithSettingType[]
> => {
  const portals = await db.query.QBPortalConnection.findMany({
    where: (QBPortalConnection) =>
      and(
        isNull(QBPortalConnection.deletedAt),
        eq(QBPortalConnection.isSuspended, false), // ignore suspended portals
      ),
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

export const getPortalTokens = async (
  portalId: string,
): Promise<IntuitAPITokensType> => {
  const portalConnection = await getPortalConnection(portalId)
  if (!portalConnection) throw new Error('Portal connection not found')

  return {
    accessToken: portalConnection.accessToken,
    refreshToken: portalConnection.refreshToken,
    intuitRealmId: portalConnection.intuitRealmId,
    incomeAccountRef: portalConnection.incomeAccountRef,
    expenseAccountRef: portalConnection.expenseAccountRef,
    assetAccountRef: portalConnection.assetAccountRef,
    serviceItemRef: portalConnection.serviceItemRef,
    clientFeeRef: portalConnection.clientFeeRef,
  }
}
