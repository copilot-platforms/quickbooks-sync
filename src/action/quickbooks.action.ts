import { AuthStatus } from '@/app/api/core/types/auth'
import { QBTokenSelectSchemaType } from '@/db/schema/qbTokens'
import {
  getPortalConnection,
  getSyncedPortalConnection,
} from '@/db/service/token.service'
import { z } from 'zod'

export async function checkPortalConnection(
  portalId: string,
): Promise<QBTokenSelectSchemaType | null> {
  try {
    return await getPortalConnection(portalId)
  } catch (err) {
    console.error('checkPortalConnection#getPortalConnection | Error =', err)
    return null
  }
}

export async function checkSyncStatus(portalId: string): Promise<boolean> {
  try {
    const syncedPortal: QBTokenSelectSchemaType | null =
      await getSyncedPortalConnection(portalId)
    return syncedPortal?.syncFlag || false
  } catch (err) {
    console.error('checkSyncStatus#getSyncedPortalConnection | Error =', err)
    return false
  }
}

export async function reconnectIfCta(type?: string) {
  if (!type) {
    return false
  }
  const parsedType = z.string().safeParse(type)
  if (parsedType.success && parsedType?.data === AuthStatus.Reconnect)
    return true
  return false
}
