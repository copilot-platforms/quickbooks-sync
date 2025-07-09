import { withErrorHandler } from '@/app/api/core/utils/withErrorHandler'
import {
  getSettings,
  updateSettings,
} from '@/app/api/quickbooks/setting/setting.controller'

export const GET = withErrorHandler(getSettings)
export const POST = withErrorHandler(updateSettings)
