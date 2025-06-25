import { withErrorHandler } from '@/app/api/core/utils/withErrorHandler'
import { getLatestSyncSuccessLog } from '@/app/api/quickbooks/syncLog/syncLog.controller'

export const GET = withErrorHandler(getLatestSyncSuccessLog)
