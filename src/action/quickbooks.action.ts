'use server'

import { AuthStatus } from '@/app/api/core/types/auth'
import { PortalConnectionWithSettingType } from '@/db/schema/qbPortalConnections'
import { QBSettingsSelectSchemaType } from '@/db/schema/qbSettings'
import {
  getPortalConnection,
  getPortalSettings,
} from '@/db/service/token.service'
import IntuitAPI, { IntuitAPITokensType } from '@/utils/intuitAPI'
import CustomLogger from '@/utils/logger'
import { z } from 'zod'

export async function checkPortalConnection(
  portalId: string,
): Promise<PortalConnectionWithSettingType | null> {
  try {
    return await getPortalConnection(portalId)
  } catch (err) {
    console.error('checkPortalConnection#getPortalConnection | Error =', err)
    return null
  }
}

export async function checkSyncStatus(portalId: string): Promise<boolean> {
  try {
    const syncedPortal: QBSettingsSelectSchemaType | null =
      await getPortalSettings(portalId)
    return syncedPortal?.syncFlag || false
  } catch (err) {
    console.error('checkSyncStatus#getPortalSettings | Error =', err)
    return false
  }
}

export async function checkForNonUsCompany(tokenInfo: IntuitAPITokensType) {
  CustomLogger.info({
    message: 'checkForNonUsCompany | Checking for non-US company',
  })
  const intuitApi = new IntuitAPI(tokenInfo)
  const companyInfo = await intuitApi.getCompanyInfo()

  CustomLogger.info({
    obj: { companyInfo },
    message: 'checkForNonUsCompany | Company Info',
  })

  return companyInfo?.Country !== 'US'
}

export async function reconnectIfCta(type?: string) {
  if (!type) {
    return false
  }
  const parsedType = z.string().safeParse(type)
  if (parsedType.success && parsedType?.data === AuthStatus.RECONNECT)
    return true
  return false
}
