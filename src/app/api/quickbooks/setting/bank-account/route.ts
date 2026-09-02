import { withErrorHandler } from '@/app/api/core/utils/withErrorHandler'
import { getBankAccounts } from '@/app/api/quickbooks/setting/bank-account/bank-account.controller'

export const maxDuration = 300 // 5 minutes

export const GET = withErrorHandler(getBankAccounts)
