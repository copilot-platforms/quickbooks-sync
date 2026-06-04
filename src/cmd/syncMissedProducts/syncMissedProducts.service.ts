import APIError from '@/app/api/core/exceptions/api'
import { BaseService } from '@/app/api/core/services/base.service'
import { withRetry } from '@/app/api/core/utils/withRetry'
import { AuthService } from '@/app/api/quickbooks/auth/auth.service'
import { StatusableError } from '@/type/CopilotApiError'
import { CopilotAPI } from '@/utils/copilotAPI'
import { and, eq } from 'drizzle-orm'
import httpStatus from 'http-status'
import { MAX_PRODUCT_LIST_LIMIT } from '@/app/api/core/constants/limit'
import IntuitAPI from '@/utils/intuitAPI'
import { bottleneck } from '@/utils/bottleneck'
import { QBItemFullUpdatePayloadType } from '@/type/dto/intuitAPI.dto'
import { QBProductSync } from '@/db/schema/qbProductSync'
import CustomLogger from '@/utils/logger'
import { truncateForQB } from '@/utils/string'

// Products updated during this window were missed during regular sync
const SYNC_WINDOW_START = new Date('2026-02-17T00:00:00.000Z')
const SYNC_WINDOW_END = new Date('2026-02-20T00:00:00.000Z') // exclusive

export class SyncMissedProductsService extends BaseService {
  async _syncMissedProductsForPortal() {
    try {
      console.info(
        `syncMissedProducts#syncMissedProductsForPortal :: Processing portal: ${this.user.workspaceId}`,
      )

      // 1. Get all the products for the portal
      const copilotApi = new CopilotAPI(this.user.token)
      const allProducts = await copilotApi.getProducts({
        limit: MAX_PRODUCT_LIST_LIMIT,
      })

      const filteredProducts = allProducts?.data?.filter(
        (product) =>
          product.updatedAt &&
          new Date(product.updatedAt) >= SYNC_WINDOW_START &&
          new Date(product.updatedAt) < SYNC_WINDOW_END,
      )

      if (!filteredProducts?.length) {
        console.info(
          `No missed products found for portal ${this.user.workspaceId}`,
        )
        return
      }

      const filteredProductIds = filteredProducts.map((product) => product.id)

      console.info(
        `Found ${filteredProductIds.length} missed products for portal ${this.user.workspaceId}`,
      )

      const mappedProducts = await this.db.query.QBProductSync.findMany({
        where: (QBProductSync, { eq, inArray, isNotNull }) =>
          and(
            eq(QBProductSync.portalId, this.user.workspaceId),
            isNotNull(QBProductSync.qbItemId),
            inArray(QBProductSync.productId, filteredProductIds),
          ),
      })

      if (!mappedProducts.length) {
        console.info(
          `No missed products found in Quickbooks for portal ${this.user.workspaceId}`,
        )
        return
      }

      // 2. update all the products in QBO
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
      const updatePromises = []
      for (const mappedProduct of mappedProducts) {
        const assemblyProduct = filteredProducts.find(
          (product) => product.id === mappedProduct.productId,
        )
        if (!assemblyProduct) {
          console.info(
            `Product not found in assembly for product id: ${mappedProduct.productId}`,
          )
          continue
        }
        if (!mappedProduct.qbItemId || !mappedProduct.qbSyncToken) {
          console.info(
            `Product qbItemId or qbSyncToken not found for product id: ${mappedProduct.productId}. QbItemId: ${mappedProduct.qbItemId}, QbSyncToken: ${mappedProduct.qbSyncToken}. Skipping...`,
          )
          continue
        }

        const payload = {
          Id: mappedProduct.qbItemId,
          Name: truncateForQB(assemblyProduct.name),
          SyncToken: mappedProduct.qbSyncToken,
          sparse: true,
          Active: true,
        }
        updatePromises.push(
          bottleneck.schedule(() => {
            return this.updateQbProduct(intuitApi, payload, mappedProduct.id)
          }),
        )
      }
      await Promise.all(updatePromises)
    } catch (error: unknown) {
      if (error instanceof APIError) {
        throw error
      }
      const assemblyError = error as StatusableError
      const status = assemblyError.status || httpStatus.BAD_REQUEST
      if (status === httpStatus.FORBIDDEN) {
        console.info(
          `Assembly sdk returns forbidden for the portal ${this.user.workspaceId}`,
        )
        return
      }
      throw error
    }
  }

  private async updateQbProduct(
    intuitApi: IntuitAPI,
    payload: QBItemFullUpdatePayloadType,
    recordId: string,
  ) {
    try {
      const response = await intuitApi.itemFullUpdate(payload)
      CustomLogger.info({
        obj: { response },
        message: `SyncMissedProductsService#updateQbProduct | Product updated in Quickbooks for product id: ${recordId}`,
      })

      // update the product map in mapping table
      const updatePayload = {
        name: response.Item.Name,
        qbSyncToken: response.Item.SyncToken,
      }
      await this.db
        .update(QBProductSync)
        .set(updatePayload)
        .where(eq(QBProductSync.id, recordId))
    } catch (error) {
      CustomLogger.error({
        message: `SyncMissedProductsService#updateQbProduct | Failed to update product: ${recordId}`,
        obj: { error, recordId },
      })
    }
  }

  private wrapWithRetry<Args extends unknown[], R>(
    fn: (...args: Args) => Promise<R>,
  ): (...args: Args) => Promise<R> {
    return (...args: Args): Promise<R> => withRetry(fn.bind(this), args)
  }

  syncMissedProductsForPortal = this.wrapWithRetry(
    this._syncMissedProductsForPortal,
  )
}
