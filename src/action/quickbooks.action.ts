import { QBTokenSelectSchemaType } from '@/db/schema/qbTokens'
import { getPortalConnection } from '@/db/service/token.service'

export async function checkPortalConnection(
  portalId: string,
): Promise<QBTokenSelectSchemaType | null> {
  try {
    const portalQBToken = await getPortalConnection(portalId)

    return portalQBToken
  } catch (err) {
    console.error('getTokenPayload | Error =', err)
    return null
  }
}
