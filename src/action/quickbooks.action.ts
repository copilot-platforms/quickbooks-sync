'use server'

import { AuthStatus } from '@/app/api/core/types/auth'
import { PortalConnectionWithSettingType } from '@/db/schema/qbPortalConnections'
import { QBSettingsSelectSchemaType } from '@/db/schema/qbSettings'
import {
  getPortalConnection,
  getPortalSettings,
} from '@/db/service/token.service'
import IntuitAPI from '@/utils/intuitAPI'
import CustomLogger from '@/utils/logger'
import {
  getValidQbTokens,
  QBReconnectRequiredError,
} from '@/utils/tokenRefresh'
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

export async function checkForNonUsCompany(portalId: string): Promise<boolean> {
  CustomLogger.info({
    message: 'checkForNonUsCompany | Checking for non-US company',
  })

  try {
    const tokenInfo = await getValidQbTokens(portalId)
    const intuitApi = new IntuitAPI(tokenInfo)
    const companyInfo = await intuitApi.getCompanyInfo()

    CustomLogger.info({
      obj: { companyInfo },
      message: 'checkForNonUsCompany | Company Info',
    })

    return companyInfo.Country !== 'US'
  } catch (error) {
    if (error instanceof QBReconnectRequiredError) {
      // Intentionally no side effects here. The next webhook/sync path to
      // run for this portal goes through AuthService.getQBPortalConnection,
      // which owns the paired disable-sync + IU-notify work. We just log
      // and return a safe default so the dashboard doesn't crash.
      CustomLogger.info({
        message: `checkForNonUsCompany | Refresh token revoked for portalId: ${portalId}. Deferring cleanup to webhook path.`,
      })
      return false
    }
    throw error
  }
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
