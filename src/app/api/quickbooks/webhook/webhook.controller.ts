import authenticate from '@/app/api/core/utils/authenticate'
import { AuthService } from '@/app/api/quickbooks/auth/auth.service'
import { WebhookService } from '@/app/api/quickbooks/webhook/webhook.service'
import * as Sentry from '@sentry/nextjs'
import { NextRequest, NextResponse } from 'next/server'

export const maxDuration = 300 // 5 minutes

export async function captureWebhookEvent(req: NextRequest) {
  return Sentry.withScope(async (scope) => {
    console.info('\n\n####### Webhook triggered #######')
    const user = await authenticate(req)
    scope.setTag('portalId', user.workspaceId)
    scope.setTag('workspaceId', user.workspaceId)

    const authService = new AuthService(user)
    const payload = await req.json()

    const qbTokenInfo = await authService.getQBPortalConnection(
      user.workspaceId,
    )
    user.qbConnection = {
      serviceItemRef: qbTokenInfo.serviceItemRef,
      clientFeeRef: qbTokenInfo.clientFeeRef,
    }
    const webhookService = new WebhookService(user)
    await webhookService.handleWebhookEvent(payload, qbTokenInfo)

    return NextResponse.json({ ok: true })
  })
}
