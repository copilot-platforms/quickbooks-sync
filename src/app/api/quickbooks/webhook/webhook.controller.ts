import authenticate from '@/app/api/core/utils/authenticate'
import { AuthService } from '@/app/api/quickbooks/auth/auth.service'
import { WebhookService } from '@/app/api/quickbooks/webhook/webhook.service'
import { NextRequest, NextResponse } from 'next/server'

export async function captureWebhookEvent(req: NextRequest) {
  console.info('\n\n####### Webhook triggered #######')
  const user = await authenticate(req)
  const authService = new AuthService(user)
  const payload = await req.json()

  const qbTokenInfo = await authService.getQBPortalConnection(user.workspaceId)

  if (qbTokenInfo?.isSuspended) {
    console.info(
      `WebhookController#captureWebhookEvent | Portal with ID: ${user.workspaceId} is suspended.`,
    )
    return NextResponse.json({
      error: `Portal with ID: ${user.workspaceId} is suspended`,
    })
  }

  user.qbConnection = {
    serviceItemRef: qbTokenInfo.serviceItemRef,
    clientFeeRef: qbTokenInfo.clientFeeRef,
  }
  const webhookService = new WebhookService(user)
  await webhookService.handleWebhookEvent(payload, qbTokenInfo)

  return NextResponse.json({ ok: true })
}
