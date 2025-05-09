import authenticate from '@/app/api/core/utils/authenticate'
import { AuthService } from '@/app/api/quickbooks/auth/auth.service'
import { WebhookService } from '@/app/api/quickbooks/webhook/webhook.service'
import { NextRequest, NextResponse } from 'next/server'

export async function captureWebhookEvent(req: NextRequest) {
  console.info('\n\n####### Webhook triggered #######')
  const user = await authenticate(req)
  const authService = new AuthService(user)
  const payload = await req.json()

  const qbTokenInfo = await authService.getQBToken(user.workspaceId)
  const webhookService = new WebhookService(user)
  await webhookService.handleWebhookEvent(payload, qbTokenInfo)

  return NextResponse.json({ ok: true })
}
