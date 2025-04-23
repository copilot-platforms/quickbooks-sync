import { withErrorHandler } from '@/app/api/core/utils/withErrorHandler'
import { checkPortalConnection } from './token.controller'

export const GET = withErrorHandler(checkPortalConnection)
