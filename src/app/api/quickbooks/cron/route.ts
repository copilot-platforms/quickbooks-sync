import { withErrorHandler } from '@/app/api/core/utils/withErrorHandler'
import { processFailedSync } from '@/app/api/quickbooks/cron/cron.controller'

export const maxDuration = 800 // 13 minutes. Docs: https://vercel.com/docs/functions/configuring-functions/duration#duration-limits

export const GET = withErrorHandler(processFailedSync)
