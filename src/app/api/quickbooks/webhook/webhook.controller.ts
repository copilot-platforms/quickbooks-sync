import { WebhookEvents } from '@/app/api/core/types/webhook'
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

export async function captureWebhookEventGET(req: NextRequest) {
  return Sentry.withScope(async (scope) => {
    console.info('\n\n####### Webhook triggered #######')
    const user = await authenticate(req)
    scope.setTag('portalId', user.workspaceId)
    scope.setTag('workspaceId', user.workspaceId)

    const authService = new AuthService(user)
    // example test payload
    const payload = {
      eventType: WebhookEvents.PAYOUT_RECONCILIATION_COMPLETED,
      eventTime: '1784705274',
      data: {
        payout: {
          id: 'po_test_7',
          arrivalDate: 1784705701,
          currency: 'usd',
          netAmount: 2844,
          status: 'paid',
        },
        lineItems: [
          {
            copilotInvoiceId: 'in_1TwL04FdviIHOKAnA2vjpthY',
            grossAmount: 1000,
            feeAmount: 62,
          },
          {
            copilotInvoiceId: 'in_1TwL3xFdviIHOKAnfnauoxkD',
            grossAmount: 2000,
            feeAmount: 94,
          },
        ],
      },
    }

    const qbTokenInfo = await authService.getQBPortalConnection(
      user.workspaceId,
    )
    user.qbConnection = {
      serviceItemRef: qbTokenInfo.serviceItemRef,
      clientFeeRef: qbTokenInfo.clientFeeRef,
    }

    if (payload.eventType === WebhookEvents.PAYOUT_RECONCILIATION_COMPLETED) {
      const webhookService = new WebhookService(user)
      await webhookService.handleWebhookEvent(payload, qbTokenInfo)
    }

    return NextResponse.json({ ok: true })
  })
}
