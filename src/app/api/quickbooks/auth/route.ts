import { withErrorHandler } from '@/app/api/core/utils/withErrorHandler'
import { getAuthorizationUrl } from '@/app/api/quickbooks/auth/auth.controller'

export const POST = withErrorHandler(getAuthorizationUrl)
