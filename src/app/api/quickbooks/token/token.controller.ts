import authenticate from '@/app/api/core/utils/authenticate'
import { TokenService } from '@/app/api/quickbooks/token/token.service'
import { changeEnableStatusRequestSchema } from '@/type/common'
import { NextRequest, NextResponse } from 'next/server'

export async function checkPortalConnection(req: NextRequest) {
  const user = await authenticate(req)
  const tokenService = new TokenService(user)
  const portalSync = await tokenService.getOneByPortalId(user.workspaceId)
  return NextResponse.json(portalSync)
}

export async function changeEnableStatus(req: NextRequest) {
  const user = await authenticate(req)
  const body = await req.json()
  const parsedBody = changeEnableStatusRequestSchema.parse(body)
  const tokenService = new TokenService(user)
  const portal = await tokenService.changeEnableStatus(
    user.workspaceId,
    parsedBody,
  )
  return NextResponse.json(portal)
}
