import authenticate from '@/app/api/core/utils/authenticate'
import { AuthService } from '@/app/api/quickbooks/auth/auth.service'
import { NextRequest, NextResponse } from 'next/server'

export async function captureWebhookEvent(req: NextRequest) {
  const user = await authenticate(req)
  const authService = new AuthService(user)
  const payload = await req.json()
  const getAccessToken = await authService.getQBAccessToken(user.workspaceId)
  console.log({ getAccessToken, payload })
  return NextResponse.json({ ok: true })
}
