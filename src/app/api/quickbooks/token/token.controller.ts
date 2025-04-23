import authenticate from '@/app/api/core/utils/authenticate'
import { TokenService } from '@/app/api/quickbooks/token/token.service'
import { NextRequest, NextResponse } from 'next/server'
import httpStatus from 'http-status'

export async function checkPortalConnection(req: NextRequest) {
  const user = await authenticate(req)
  const tokenService = new TokenService(user)
  const portalSync = await tokenService.checkPortalConnection(user.workspaceId)
  return NextResponse.json(portalSync, { status: httpStatus.OK })
}
