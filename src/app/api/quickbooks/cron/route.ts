import { withErrorHandler } from '@/app/api/core/utils/withErrorHandler'
import { processFailedSync } from '@/app/api/quickbooks/cron/cron.controller'

export const maxDuration = 300 // 5 min normally, 13 minutes with Fluid Compute.
// Docs: https://vercel.com/docs/functions/configuring-functions/duration#duration-limits

export const GET = withErrorHandler(processFailedSync)
