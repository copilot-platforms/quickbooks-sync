import { MAX_PRODUCT_LIST_LIMIT } from '@/app/api/core/constants/limit'
import { BaseService } from '@/app/api/core/services/base.service'
import { QBItemType } from '@/app/api/core/types/product'
import { buildReturningFields } from '@/db/helper/drizzle.helper'
import {
  QBProductCreateSchema,
  QBProductCreateSchemaType,
  QBProductSync,
  QBProductSelectSchemaType,
  QBProductCreateArraySchemaType,
  QBProductUpdateSchemaType,
  QBProductUpdateSchema,
} from '@/db/schema/qbProductSync'
import RedisClient from '@/lib/redis'
import { ProductsResponse } from '@/type/common'
import { QBItemFullUpdatePayloadType } from '@/type/dto/intuitAPI.dto'
import { ProductCreatedResponseType } from '@/type/dto/webhook.dto'
import { CopilotAPI } from '@/utils/copilotAPI'
import IntuitAPI, { IntuitAPITokensType } from '@/utils/intuitAPI'
import { and, eq, isNull, SQL } from 'drizzle-orm'
import { convert } from 'html-to-text'

type WhereClause = SQL<unknown>
export class ProductService extends BaseService {
  async getMappingByProductPriceId(
    productId: string,
    priceId: string,
    returningFields?: (keyof typeof QBProductSync)[],
  ): Promise<QBProductSelectSchemaType | undefined> {
    let columns = null
    if (returningFields && returningFields.length > 0) {
      columns = buildReturningFields(QBProductSync, returningFields, true)
    }

    return await this.db.query.QBProductSync.findFirst({
      where: (QBProductSync, { eq }) =>
        and(
          isNull(QBProductSync.deletedAt),
          eq(QBProductSync.productId, productId),
          eq(QBProductSync.priceId, priceId),
          eq(QBProductSync.portalId, this.user.workspaceId),
        ),
      ...(columns && { columns }),
    })
  }

  /**
   * Get all the mapped products by product id
   */
  async getAllByProductId(
    productId: string,
    returningFields?: (keyof typeof QBProductSync)[],
  ): Promise<QBProductSelectSchemaType[] | undefined> {
    let columns = null
    if (returningFields && returningFields.length > 0) {
      columns = buildReturningFields(QBProductSync, returningFields, true)
    }

    return await this.db.query.QBProductSync.findMany({
      where: (QBProductSync, { eq }) =>
        and(
          eq(QBProductSync.productId, productId),
          eq(QBProductSync.portalId, this.user.workspaceId),
        ),
      ...(columns && { columns }),
    })
  }

  /**
   * Creates the map of product and price with QB item
   */
  async createQBProduct(
    payload: QBProductCreateSchemaType,
    returningFields?: (keyof typeof QBProductSync)[],
  ): Promise<Partial<QBProductSelectSchemaType> | undefined> {
    const parsedInsertPayload = QBProductCreateSchema.parse(payload)
    const query = this.db.insert(QBProductSync).values(parsedInsertPayload)

    const [product] =
      returningFields && returningFields.length > 0
        ? await query.returning(
            buildReturningFields(QBProductSync, returningFields),
          )
        : await query.returning()

    return product
  }

  /**
   * Bulk creates the map between product, price with QB item
   */
  async bulkCreateQBProduct(
    payload: QBProductCreateArraySchemaType,
    returningFields?: (keyof typeof QBProductSync)[],
  ): Promise<Partial<QBProductSelectSchemaType>[] | undefined> {
    const formattedPaylaod = payload.map((item) => {
      return {
        ...item,
        portalId: this.user.workspaceId,
      }
    })
    const query = this.db.insert(QBProductSync).values(formattedPaylaod)

    const product =
      returningFields && returningFields.length > 0
        ? await query.returning(
            buildReturningFields(QBProductSync, returningFields),
          )
        : await query.returning()

    return product
  }
  async updateQBToken(
    payload: QBProductUpdateSchemaType,
    conditions: WhereClause,
    returningFields?: (keyof typeof QBProductSync)[],
  ) {
    const parsedInsertPayload = QBProductUpdateSchema.parse(payload)

    const query = this.db
      .update(QBProductSync)
      .set(parsedInsertPayload)
      .where(conditions)

    const [product] =
      returningFields && returningFields.length > 0
        ? await query.returning(
            buildReturningFields(QBProductSync, returningFields),
          )
        : await query.returning()

    return product
  }

  async createItemInQB(
    opts: {
      productName: string
      unitPrice: number
      incomeAccRefVal: string
      productDescription?: string
    },
    intuitApi: IntuitAPI,
  ) {
    // create item in QB
    const qbItemPayload = {
      Name: opts.productName,
      UnitPrice: opts.unitPrice / 100,
      IncomeAccountRef: {
        value: opts.incomeAccRefVal, // required to enable sales in QB company
      },
      Type: QBItemType.SERVICE,
      Taxable: true, // to enable tax for the product
      Description: opts.productDescription,
    }
    return await intuitApi.createItem(qbItemPayload)
  }

  /**
   * Flattens the product list with price: one product with one price and stores the result in redis
   */
  async getFlattenProductList(
    limit: number,
    nextToken?: string,
  ): Promise<ProductsResponse> {
    // 1. check in redis. key (${workspaceId}_productList) if exists, return the value
    const redisKey = `${this.user.workspaceId}-productList${nextToken ? '-' + nextToken : ''}`
    const redisClient = RedisClient.getInstance()

    const cachedProducts: ProductsResponse | null =
      await redisClient.get(redisKey)
    if (cachedProducts) {
      return cachedProducts // auto deserialization by default
    }

    // 2. if not exists, get all the products from copilot and store in redis
    const copilot = new CopilotAPI(this.user.token)
    const products = await copilot.getProducts(undefined, nextToken, limit)
    const flattenProductsPrice = (
      await Promise.all(
        (products?.data ?? []).map(async (product) => {
          const prices = await copilot.getPrices(product.id)
          return (prices?.data ?? []).map((price) => ({
            ...product,
            priceId: price.id,
            amount: price.amount,
            type: price.type,
            interval: price.interval,
            currency: price.currency,
          }))
        }),
      )
    ).flat()

    const formattedData = {
      data: flattenProductsPrice,
      ...(products?.nextToken && { nextToken: products.nextToken }),
    }

    await redisClient.set(redisKey, JSON.stringify(formattedData))
    console.info('WebhookService#getFlattenProductList | Data cached in Redis')

    return formattedData
  }

  async refreshCachedProductList() {
    // remove all the cached products in redis to add fresh one
    const redisKey = `${this.user.workspaceId}-productList`
    const redisClient = RedisClient.getInstance()

    let cursor = '0'
    do {
      const [newCursor, keys] = await redisClient.scan(cursor, {
        match: `${redisKey}*`, // uses globs pattern. match all keys with given redisKey to remove paginated products
        count: MAX_PRODUCT_LIST_LIMIT, // keys count to fetch at a time
      })

      cursor = newCursor
      if (keys.length) {
        await redisClient.del(...keys)
      }
    } while (cursor !== '0') // cursor 0 means complete
    console.info('WebhookService#webhookProductUpdated | Redis cache cleared')

    // store fresh data in redis
    await this.getFlattenProductList(MAX_PRODUCT_LIST_LIMIT)
  }

  /**
   * Updates the cached product list in redis
   */
  async webhookProductUpdated(
    resource: ProductCreatedResponseType,
    qbTokenInfo: IntuitAPITokensType,
  ): Promise<void> {
    const productResource = resource.data

    // 01. get all the mapped product ids with qb id
    const mappedProducts = await this.getAllByProductId(productResource.id, [
      'id',
      'qbItemId',
      'qbSyncToken',
      'name',
      'description',
      'unitPrice',
    ])

    if (!mappedProducts || !mappedProducts.length) {
      console.info(
        'WebhookService#webhookProductUpdated | No mapped products found',
      )
      return
    }

    let updateCount = 0
    await Promise.all(
      mappedProducts.map(async (product) => {
        // 02. track change and sparse update the each item
        if (
          productResource.name !== product.name ||
          productResource.description !== product.description
        ) {
          console.info(
            `WebhookService#webhookProductUpdated | Update item in QB for QB Id = ${product.qbItemId}`,
          )
          let productDescription = ''
          if (productResource.description) {
            productDescription = convert(productResource.description)
          }

          const fullUpdatePayload: QBItemFullUpdatePayloadType = {
            Id: product.qbItemId,
            SyncToken: product.qbSyncToken,
            Name: productResource.name,
            ...(productDescription && { Description: productDescription }),
            ...(product.unitPrice
              ? { UnitPrice: parseFloat(product.unitPrice) / 100 }
              : {}),
            IncomeAccountRef: {
              value: qbTokenInfo.incomeAccountRef,
            },
            Taxable: true,
            Type: QBItemType.SERVICE,
          }

          const intuitApi = new IntuitAPI(qbTokenInfo)
          const itemRes = await intuitApi.itemFullUpdate(fullUpdatePayload)

          // update the product map in db
          const mapUpdatePayload = {
            qbSyncToken: itemRes.Item.SyncToken,
            name: productResource.name,
            description: productDescription,
          }
          const whereConditions = eq(QBProductSync.id, product.id)
          await this.updateQBToken(mapUpdatePayload, whereConditions)

          updateCount++
        }
      }),
    )

    // 03. refresh cache data
    if (updateCount > 0) await this.refreshCachedProductList()
  }
}
