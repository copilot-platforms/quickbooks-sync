import { withErrorHandler } from '@/app/api/core/utils/withErrorHandler'
import { captureWebhookEvent } from '@/app/api/quickbooks/webhook/webhook.controller'

export const POST = withErrorHandler(captureWebhookEvent)
