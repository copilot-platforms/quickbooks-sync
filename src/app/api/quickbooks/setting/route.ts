import { withErrorHandler } from '@/app/api/core/utils/withErrorHandler'
import { getSettings } from '@/app/api/quickbooks/setting/setting.controller'

export const GET = withErrorHandler(getSettings)
