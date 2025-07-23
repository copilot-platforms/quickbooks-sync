import authenticate from '@/app/api/core/utils/authenticate'
import { AuthService } from '@/app/api/quickbooks/auth/auth.service'
import { NextRequest, NextResponse } from 'next/server'

export async function getAuthorizationUrl(req: NextRequest) {
  const user = await authenticate(req)
  const token = user.token
  const body = await req.json()
  const redirectUrl = body?.redirectUrl || req.headers.get('referer')
  const type = new URL(req.url).searchParams.get('type') || undefined
  const authService = new AuthService(user)
  const authUrl = await authService.getAuthUrl(
    {
      token,
      originUrl: redirectUrl,
    },
    type,
  )
  return NextResponse.json(authUrl)
}

export const handleTokenExchange = async (req: NextRequest) => {
  const user = await authenticate(req)
  const authService = new AuthService(user)
  const body = await req.json()
  const response = await authService.handleTokenExchange(body, user.workspaceId)
  return NextResponse.json({ response })
}

export const handleConnectionError = async (req: NextRequest) => {
  const user = await authenticate(req)
  const authService = new AuthService(user)
  const response = await authService.handleConnectionError(user.workspaceId)
  return NextResponse.json({ response })
}
