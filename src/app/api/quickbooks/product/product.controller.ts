import { MAX_PRODUCT_LIST_LIMIT } from '@/app/api/core/constants/limit'
import authenticate from '@/app/api/core/utils/authenticate'
import { ProductService } from '@/app/api/quickbooks/product/product.service'
import { QBProductCreateArraySchema } from '@/db/schema/qbProductSync'
import { NextRequest, NextResponse } from 'next/server'

export async function getFlattenProducts(req: NextRequest) {
  const user = await authenticate(req)
  const productService = new ProductService(user)
  const nextToken = req.nextUrl.searchParams.get('nextToken') || undefined
  const limit = req.nextUrl.searchParams.get('limit') || MAX_PRODUCT_LIST_LIMIT
  const products = await productService.getFlattenProductList(
    Number(limit),
    nextToken,
  )
  return NextResponse.json(products)
}

export async function storeProductMap(req: NextRequest) {
  const user = await authenticate(req)
  const productService = new ProductService(user)
  const body = await req.json()
  const parsedBody = QBProductCreateArraySchema.parse(body)
  const productMapping = await productService.bulkCreateQBProduct(parsedBody)
  return NextResponse.json(productMapping)
}
