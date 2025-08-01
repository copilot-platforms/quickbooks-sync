import { MAX_PRODUCT_LIST_LIMIT } from '@/app/api/core/constants/limit'
import APIError from '@/app/api/core/exceptions/api'
import authenticate from '@/app/api/core/utils/authenticate'
import { AuthService } from '@/app/api/quickbooks/auth/auth.service'
import { ProductService } from '@/app/api/quickbooks/product/product.service'
import { ProductMappingSchema } from '@/db/schema/qbProductSync'
import { NextRequest, NextResponse } from 'next/server'
import httpStatus from 'http-status'

export async function getFlattenProducts(req: NextRequest) {
  const user = await authenticate(req)
  const productService = new ProductService(user)
  const searchParams = req.nextUrl.searchParams
  const nextToken = searchParams.get('nextToken') || undefined
  const limit = Number(searchParams.get('limit')) || MAX_PRODUCT_LIST_LIMIT
  const products = await productService.getFlattenProductList(limit, nextToken)
  return NextResponse.json(products)
}

export async function storeProductMap(req: NextRequest) {
  const user = await authenticate(req)
  const productService = new ProductService(user)
  const body = await req.json()
  const parsedBody = ProductMappingSchema.parse(body)
  const products = await productService.bulkDeleteCreateQBProduct(
    parsedBody.mappingItems,
  )
  if (parsedBody.changedItemReference.length > 0)
    await productService.formatAndSyncProductLogs(
      parsedBody.changedItemReference,
    )
  return NextResponse.json(products)
}

export async function getAll(req: NextRequest) {
  const user = await authenticate(req)
  const productService = new ProductService(user)
  const mapping = await productService.getAll()
  return NextResponse.json(mapping)
}

export async function getItemsFromQB(req: NextRequest) {
  const user = await authenticate(req)
  const authService = new AuthService(user)
  const qbTokenInfo = await authService.getQBPortalConnection(
    user.workspaceId,
    true,
  )
  if (!qbTokenInfo || !qbTokenInfo.accessToken) {
    throw new APIError(
      httpStatus.UNAUTHORIZED,
      'Tokens expired. Reauthorization required.',
    )
  }
  const productService = new ProductService(user)
  const items = await productService.queryItemsFromQB(
    qbTokenInfo,
    MAX_PRODUCT_LIST_LIMIT,
    ['Id', 'Name', 'UnitPrice', 'SyncToken', 'Description'],
  )
  return NextResponse.json(items)
}
