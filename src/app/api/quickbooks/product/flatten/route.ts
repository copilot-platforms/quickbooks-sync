import { withErrorHandler } from '@/app/api/core/utils/withErrorHandler'
import { getFlattenProducts } from '@/app/api/quickbooks/product/product.controller'

export const GET = withErrorHandler(getFlattenProducts)
