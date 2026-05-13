import { MAX_PRODUCT_LIST_LIMIT } from '@/app/api/core/constants/limit'
import APIError from '@/app/api/core/exceptions/api'
import { BaseService } from '@/app/api/core/services/base.service'
import { withRetry } from '@/app/api/core/utils/withRetry'
import { AuthService } from '@/app/api/quickbooks/auth/auth.service'
import { ProductService } from '@/app/api/quickbooks/product/product.service'
import {
  QBProductSelectSchemaType,
  QBProductSync,
} from '@/db/schema/qbProductSync'
import { StatusableError } from '@/type/CopilotApiError'
import { CopilotAPI } from '@/utils/copilotAPI'
import IntuitAPI from '@/utils/intuitAPI'
import { eq, isNotNull } from 'drizzle-orm'
import { convert } from 'html-to-text'
import httpStatus from 'http-status'

export class BackfillProductInfoService extends BaseService {
  async _backfillProductInfoForPortal() {
    try {
      console.info(
        `BackfillProductInfoService#backfillProductInfoForPortal :: Backfilling product info for portal: ${this.user.workspaceId}`,
      )

      // 1. get all mapped products from our mapping table
      const productService = new ProductService(this.user)
      const mappedProducts: QBProductSelectSchemaType[] =
        await productService.getAll(isNotNull(QBProductSync.qbItemId))
      const mappedAssemblyProductIds = [
        ...new Set(mappedProducts.map((product) => product.productId)),
      ]

      if (mappedAssemblyProductIds.length === 0) {
        console.info(
          `No mapped product found for portal: ${this.user.workspaceId}`,
        )
        return
      }

      // 2. get all products from assembly
      const copilotApi = new CopilotAPI(this.user.token)
      const assemblyProducts = (
        await copilotApi.getProducts(
          undefined,
          undefined,
          MAX_PRODUCT_LIST_LIMIT,
        )
      )?.data

      if (!assemblyProducts) {
        console.info('No product found in assembly')
        return
      }

      const filteredAssemblyProducts = assemblyProducts.filter((product) =>
        mappedAssemblyProductIds.includes(product.id),
      )

      const authService = new AuthService(this.user)
      const qbTokenInfo = await authService.getQBPortalConnection(
        this.user.workspaceId,
      )

      if (!qbTokenInfo.accessToken || !qbTokenInfo.refreshToken) {
        console.info(
          `No access token found for portal: ${this.user.workspaceId}`,
        )
        return
      }

      const intuitApi = new IntuitAPI(qbTokenInfo)
      const allQbItems = await intuitApi.getAllItems(MAX_PRODUCT_LIST_LIMIT)

      // 3. update the product info in our mapping table
      for (const mappedProduct of mappedProducts) {
        if (!mappedProduct.qbItemId) {
          console.info(`Qb item id not found for product ${mappedProduct.name}`)
          continue
        }

        const assemblyProduct = filteredAssemblyProducts.find(
          (item) => item.id === mappedProduct.productId,
        )

        if (!assemblyProduct) {
          console.info(
            `Copilot product not found for product ${mappedProduct.name} ${mappedProduct.productId}`,
          )
          continue
        }

        // 4. get item from QB
        const qbItem = allQbItems?.find(
          (item) => item.Id === mappedProduct.qbItemId,
        )
        if (!qbItem) {
          console.info(
            `Item not found in Quickbooks for product with assembly ID ${mappedProduct.productId}`,
          )
        }

        console.info(
          `\nUpdating item info in mapping table for product with QB id ${mappedProduct.qbItemId}. Product map id ${mappedProduct.id}`,
        )

        const payload = {
          name: qbItem?.Name || null,
          copilotName: assemblyProduct.name,
          description: assemblyProduct.description
            ? convert(assemblyProduct.description)
            : '',
          ...(qbItem?.SyncToken && { qbSyncToken: qbItem.SyncToken }),
        }
        await productService.updateQBProduct(
          payload,
          eq(QBProductSync.id, mappedProduct.id),
        )
      }
    } catch (error: unknown) {
      if (error instanceof APIError) {
        throw error
      }
      const AssemnblyError = error as StatusableError // no
      const status = AssemnblyError.status || httpStatus.BAD_REQUEST
      if (status === httpStatus.FORBIDDEN) {
        console.info(
          `Assembly sdk returns forbidden for the portal ${this.user.workspaceId}`,
        )
        return
      }
      throw error
    }
  }

  private wrapWithRetry<Args extends unknown[], R>(
    fn: (...args: Args) => Promise<R>,
  ): (...args: Args) => Promise<R> {
    return (...args: Args): Promise<R> => withRetry(fn.bind(this), args)
  }

  backfillProductInfoForPortal = this.wrapWithRetry(
    this._backfillProductInfoForPortal,
  )
}
