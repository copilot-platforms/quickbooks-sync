import { withErrorHandler } from '@/app/api/core/utils/withErrorHandler'
import {
  captureWebhookEvent,
  captureWebhookEventGET,
} from '@/app/api/quickbooks/webhook/webhook.controller'

export const maxDuration = 300 // 5 minutes

export const POST = withErrorHandler(captureWebhookEvent)
export const GET = withErrorHandler(captureWebhookEventGET)
