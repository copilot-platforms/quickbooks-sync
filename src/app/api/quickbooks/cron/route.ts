import { withErrorHandler } from '@/app/api/core/utils/withErrorHandler'
import { processFailedSync } from '@/app/api/quickbooks/cron/cron.controller'

export const GET = withErrorHandler(processFailedSync)
