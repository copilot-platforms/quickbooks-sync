import authenticate from '@/app/api/core/utils/authenticate'
import { AuthService } from '@/app/api/quickbooks/auth/auth.service'
import httpStatus from 'http-status'
import { NextRequest, NextResponse } from 'next/server'

export async function getAuthorizationUrl(req: NextRequest) {
  const user = await authenticate(req)
  const token = req.nextUrl.searchParams.get('token') || ''
  const body = await req.json()
  const redirectUrl = body?.redirectUrl || req.headers.get('referer')
  const authService = new AuthService(user)
  const authUrl = await authService.getAuthUrl({
    token: token,
    originUrl: redirectUrl,
  })
  return NextResponse.json(authUrl, { status: httpStatus.OK })
}

export const handleTokenExchange = async (req: NextRequest) => {
  const user = await authenticate(req)
  const authService = new AuthService(user)
  const body = await req.json()
  const response = await authService.handleTokenExchange(body, user.workspaceId)
  return NextResponse.json({ response })
}
