import { getTokenPayload } from '@/action/copilot.action'
import { checkPortalConnection } from '@/action/quickbooks.action'
import HomeClient from '@/app/(home)/HomeClient'
import { z } from 'zod'

export default async function Main({
  searchParams,
}: {
  searchParams: Promise<{ token: string }>
}) {
  const { token } = await searchParams
  if (!token) {
    return <> No token available </>
  }

  const parsedToken = z.string().safeParse(token)
  if (!parsedToken.success) {
    return <>Failed to parse token</>
  }

  const tokenPayload = await getTokenPayload(token)
  if (!tokenPayload) {
    return <>Not a valid token</>
  }

  const portalConnection = await checkPortalConnection(tokenPayload.workspaceId)
  const portalStatus =
    portalConnection && Object.keys(portalConnection).length > 0 ? true : false

  return (
    <>
      <HomeClient token={token} portalConnectionStatus={portalStatus} />
    </>
  )
}
