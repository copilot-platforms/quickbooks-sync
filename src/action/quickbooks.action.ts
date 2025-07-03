import { AuthStatus } from '@/app/api/core/types/auth'
import { QBPortalConnectionSelectSchemaType } from '@/db/schema/qbPortalConnections'
import {
  getPortalConnection,
  getSyncedPortalConnection,
} from '@/db/service/token.service'
import { z } from 'zod'

export async function checkPortalConnection(
  portalId: string,
): Promise<QBPortalConnectionSelectSchemaType | null> {
  try {
    return await getPortalConnection(portalId)
  } catch (err) {
    console.error('checkPortalConnection#getPortalConnection | Error =', err)
    return null
  }
}

export async function checkSyncStatus(portalId: string): Promise<boolean> {
  try {
    const syncedPortal: QBPortalConnectionSelectSchemaType | null =
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
  if (parsedType.success && parsedType?.data === AuthStatus.RECONNECT)
    return true
  return false
}
