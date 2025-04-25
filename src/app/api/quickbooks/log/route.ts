import { withErrorHandler } from '@/app/api/core/utils/withErrorHandler'
import { storeQbConnectionLog } from '@/app/api/quickbooks/log/log.controller'

export const POST = withErrorHandler(storeQbConnectionLog)
