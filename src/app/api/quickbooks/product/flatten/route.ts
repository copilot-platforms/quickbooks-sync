import { withErrorHandler } from '@/app/api/core/utils/withErrorHandler'
import { getProductsForMapping } from '@/app/api/quickbooks/product/product.controller'

export const maxDuration = 300 // 5 minutes

export const GET = withErrorHandler(getProductsForMapping)
