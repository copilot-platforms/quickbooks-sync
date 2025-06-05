import { withErrorHandler } from '@/app/api/core/utils/withErrorHandler'
import { changeEnableStatus } from '@/app/api/quickbooks/token/token.controller'

export const POST = withErrorHandler(changeEnableStatus)
