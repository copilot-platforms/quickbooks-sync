import { getLatestSuccessLog } from '@/app/api/quickbooks/log/log.controller'
import { withErrorHandler } from '@/app/api/core/utils/withErrorHandler'

export const GET = withErrorHandler(getLatestSuccessLog)
