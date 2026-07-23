import { withErrorHandler } from '@/app/api/core/utils/withErrorHandler'
import { getBankAccounts } from '@/app/api/quickbooks/setting/bank-account/bank-account.controller'

export const GET = withErrorHandler(getBankAccounts)
