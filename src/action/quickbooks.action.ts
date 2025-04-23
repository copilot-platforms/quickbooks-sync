import { getPortalConnection } from '@/db/service/token.service'

export async function checkPortalConnection(
  portalId: string,
): Promise<object | null> {
  try {
    const portalSync = await getPortalConnection(portalId)

    return portalSync || null
  } catch (err) {
    console.error('getTokenPayload | Error =', err)
    return null
  }
}
