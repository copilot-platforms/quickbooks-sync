import { getTokenPayload } from '@/action/copilot.action'
import {
  checkPortalConnection,
  checkSyncStatus,
  reconnectIfCta,
} from '@/action/quickbooks.action'
import HomeClient from '@/app/(home)/HomeClient'
import { AuthProvider } from '@/app/context/AuthContext'
import { SilentError } from '@/components/template/SilentError'
import { z } from 'zod'

export default async function Main({
  searchParams,
}: {
  searchParams: Promise<{ token: string; type?: string }>
}) {
  const { token, type } = await searchParams
  if (!token) {
    return <SilentError message="No token available" />
  }

  const parsedToken = z.string().safeParse(token)
  if (!parsedToken.success) {
    return <SilentError message="Failed to parse token" />
  }

  const tokenPayload = await getTokenPayload(token)
  if (!tokenPayload) {
    return <SilentError message="Not a valid token" />
  }

  if (!tokenPayload.internalUserId || tokenPayload.clientId) {
    // only access for IU
    return <SilentError message="No access to the user" />
  }

  const portalConnection = await checkPortalConnection(tokenPayload.workspaceId)
  const portalConnectionStatus =
    portalConnection && Object.keys(portalConnection).length > 0 ? true : false

  let reconnect = false,
    syncFlag = false
  if (portalConnectionStatus) {
    syncFlag = await checkSyncStatus(tokenPayload.workspaceId)

    if (!syncFlag) {
      reconnect = await reconnectIfCta(type)
    }
  }

  return (
    <>
      <AuthProvider
        token={token}
        tokenPayload={tokenPayload}
        syncFlag={syncFlag}
        reconnect={reconnect}
        portalConnectionStatus={portalConnectionStatus}
      >
        <HomeClient />
      </AuthProvider>
    </>
  )
}
