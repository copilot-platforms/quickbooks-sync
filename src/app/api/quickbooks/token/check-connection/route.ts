import { withErrorHandler } from '@/app/api/core/utils/withErrorHandler'
import { checkPortalConnection } from '@/app/api/quickbooks/token/token.controller'

export const GET = withErrorHandler(checkPortalConnection)
