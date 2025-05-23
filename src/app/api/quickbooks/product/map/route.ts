import { withErrorHandler } from '@/app/api/core/utils/withErrorHandler'
import { storeProductMap } from '@/app/api/quickbooks/product/product.controller'

export const POST = withErrorHandler(storeProductMap)
