import { getTokenPayload } from '@/action/copilot.action'
import {
  checkPortalConnection,
  reconnectIfCta,
} from '@/action/quickbooks.action'
import HomeClient from '@/app/(home)/HomeClient'
import User from '@/app/api/core/models/User.model'
import { SyncLogService } from '@/app/api/quickbooks/syncLog/syncLog.service'
import { AppProvider } from '@/app/context/AppContext'
import { SilentError } from '@/components/template/SilentError'
import { getWorkspaceInfo } from '@/db/service/token.service'
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

  const syncLogService = new SyncLogService(new User(token, tokenPayload))

  const [portalConnection, workspace, latestSuccessLog] = await Promise.all([
    checkPortalConnection(tokenPayload.workspaceId),
    getWorkspaceInfo(token),
    syncLogService.getLatestSyncSuccessLog().catch((err) => {
      console.error('Home#getLatestSyncSuccessLog | Error =', err)
      return null
    }),
  ])

  const portalConnectionStatus = !!(
    portalConnection && Object.keys(portalConnection).length
  )
  const syncFlag = portalConnection?.setting?.syncFlag ?? false
  const isEnabled = portalConnection?.setting?.isEnabled ?? false
  const reconnect =
    portalConnectionStatus && !syncFlag ? await reconnectIfCta(type) : false
  const lastSyncTimestamp =
    portalConnectionStatus && syncFlag
      ? (latestSuccessLog?.updatedAt?.toISOString() ?? null)
      : null

  return (
    <AppProvider
      token={token}
      tokenPayload={tokenPayload}
      syncFlag={syncFlag}
      reconnect={reconnect}
      portalConnectionStatus={portalConnectionStatus}
      isEnabled={isEnabled}
      lastSyncTimestamp={lastSyncTimestamp}
      workspace={workspace}
    >
      <HomeClient />
    </AppProvider>
  )
}
