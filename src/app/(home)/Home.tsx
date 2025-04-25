import { getTokenPayload } from '@/action/copilot.action'
import {
  checkPortalConnection,
  checkSyncStatus,
} from '@/action/quickbooks.action'
import HomeClient from '@/app/(home)/HomeClient'
import { SilentError } from '@/components/template/SilentError'
import { z } from 'zod'

export default async function Main({
  searchParams,
}: {
  searchParams: Promise<{ token: string }>
}) {
  const { token } = await searchParams
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

  const portalConnection = await checkPortalConnection(tokenPayload.workspaceId)
  const portalConnectionStatus =
    portalConnection && Object.keys(portalConnection).length > 0 ? true : false

  const syncFlag = await checkSyncStatus(tokenPayload.workspaceId)

  return (
    <>
      <HomeClient
        token={token}
        portalConnectionStatus={portalConnectionStatus}
        tokenPayload={tokenPayload}
        syncFlag={syncFlag}
      />
    </>
  )
}
