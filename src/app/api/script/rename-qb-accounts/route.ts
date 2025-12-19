import { withErrorHandler } from '@/app/api/core/utils/withErrorHandler'
import { renameQbAccountName } from '@/app/api/script/rename-qb-accounts/renameQbAccount.controller'

export const maxDuration = 800 // 13 minutes. Docs: https://vercel.com/docs/functions/configuring-functions/duration#duration-limits

export const GET = withErrorHandler(renameQbAccountName)
