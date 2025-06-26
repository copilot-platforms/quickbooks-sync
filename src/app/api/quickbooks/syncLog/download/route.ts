import { withErrorHandler } from '@/app/api/core/utils/withErrorHandler'
import { downloadSyncLogs } from '@/app/api/quickbooks/syncLog/syncLog.controller'

export const GET = withErrorHandler(downloadSyncLogs)
