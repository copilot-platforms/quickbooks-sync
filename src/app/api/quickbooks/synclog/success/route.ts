import { getLatestSyncSuccessLog } from '@/app/api/quickbooks/synclog/synclog.controller'
import { withErrorHandler } from '@/app/api/core/utils/withErrorHandler'

export const GET = withErrorHandler(getLatestSyncSuccessLog)
