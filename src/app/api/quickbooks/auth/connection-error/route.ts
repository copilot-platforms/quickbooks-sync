import { withErrorHandler } from '@/app/api/core/utils/withErrorHandler'
import { handleConnectionError } from '@/app/api/quickbooks/auth/auth.controller'

export const POST = withErrorHandler(handleConnectionError)
