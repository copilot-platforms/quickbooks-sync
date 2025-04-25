import { QBTokenSelectSchemaType } from '@/db/schema/qbTokens'
import {
  getPortalConnection,
  getSyncedPortalConnection,
} from '@/db/service/token.service'

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
    return !syncedPortal ? false : syncedPortal?.syncFlag || false
  } catch (err) {
    console.error('checkSyncStatus#getSyncedPortalConnection | Error =', err)
    return false
  }
}
