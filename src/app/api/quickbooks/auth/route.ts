import { withErrorHandler } from '@/app/api/core/utils/withErrorHandler'
import { getAuthorizationUrl } from './auth.controller'

export const POST = withErrorHandler(getAuthorizationUrl)
