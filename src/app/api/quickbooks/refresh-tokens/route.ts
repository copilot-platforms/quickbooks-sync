import { withErrorHandler } from '@/app/api/core/utils/withErrorHandler'
import { refreshExpiringTokensCron } from '@/app/api/quickbooks/refresh-tokens/refresh-tokens.controller'

export const maxDuration = 300 // 5 min — see refresh-tokens.service.ts for batch sizing.

export const GET = withErrorHandler(refreshExpiringTokensCron)
