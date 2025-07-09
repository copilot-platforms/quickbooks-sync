import { withErrorHandler } from '@/app/api/core/utils/withErrorHandler'
import {
  getAll,
  storeProductMap,
} from '@/app/api/quickbooks/product/product.controller'

export const POST = withErrorHandler(storeProductMap)
export const GET = withErrorHandler(getAll)
