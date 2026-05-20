import { withErrorHandler } from '@/app/api/core/utils/withErrorHandler'
import {
  listAccounts,
  updateAccountRefs,
} from '@/app/api/quickbooks/accounts/accounts.controller'

export const maxDuration = 300 // 5 minutes

export const GET = withErrorHandler(listAccounts)
export const PATCH = withErrorHandler(updateAccountRefs)
