import { withErrorHandler } from '@/app/api/core/utils/withErrorHandler'
import { handleTokenExchange } from '@/app/api/quickbooks/auth/auth.controller'

export const POST = withErrorHandler(handleTokenExchange)
