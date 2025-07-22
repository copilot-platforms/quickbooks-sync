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
  ProductChangedItemReferenceType,
} from '@/db/schema/qbProductSync'
import { ProductResponse, WhereClause } from '@/type/common'
import { ProductFlattenArrayResponseType } from '@/type/dto/api.dto'
import { bottleneck } from '@/utils/bottleneck'
import { QBItemFullUpdatePayloadType } from '@/type/dto/intuitAPI.dto'
import {
  PriceCreatedResponseType,
  ProductCreatedResponseType,
  ProductUpdatedResponseType,
} from '@/type/dto/webhook.dto'
import { CopilotAPI } from '@/utils/copilotAPI'
import IntuitAPI, { IntuitAPITokensType } from '@/utils/intuitAPI'
import { and, desc, eq, inArray, isNull, not } from 'drizzle-orm'
import { convert } from 'html-to-text'
import { z } from 'zod'
import { SyncLogService } from '@/app/api/quickbooks/syncLog/syncLog.service'
import { EntityType, EventType, LogStatus } from '@/app/api/core/types/log'
import dayjs from 'dayjs'
import APIError from '@/app/api/core/exceptions/api'
import httpStatus from 'http-status'
import { QBSyncLog, QBSyncLogCreateSchemaType } from '@/db/schema/qbSyncLogs'
import User from '@/app/api/core/models/User.model'

export class ProductService extends BaseService {
  private syncLogService: SyncLogService
  constructor(user: User) {
    super(user)
    this.syncLogService = new SyncLogService(user)
  }

  async getMappingByProductPriceId(
    productId: string,
    priceId: string,
    returningFields?: (keyof typeof QBProductSync)[],
  ): Promise<QBProductSelectSchemaType | undefined> {
    let columns = null
    if (returningFields?.length) {
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
      ...columns,
    })
  }

  async getOne(
    conditions: WhereClause,
    returningFields?: (keyof typeof QBProductSync)[],
  ): Promise<QBProductSelectSchemaType | undefined> {
    let columns = null
    if (returningFields?.length) {
      columns = buildReturningFields(QBProductSync, returningFields, true)
    }

    return await this.db.query.QBProductSync.findFirst({
      where: conditions,
      ...columns,
    })
  }

  /**
   * Get all the mapped products by product id
   */
  async getAllByProductId(
    productId: string,
    conditions?: WhereClause,
    returningFields?: (keyof typeof QBProductSync)[],
  ): Promise<QBProductSelectSchemaType[] | undefined> {
    let columns = null
    if (returningFields?.length) {
      columns = buildReturningFields(QBProductSync, returningFields, true)
    }

    return await this.db.query.QBProductSync.findMany({
      where: (QBProductSync, { eq }) =>
        and(
          eq(QBProductSync.productId, productId),
          eq(QBProductSync.portalId, this.user.workspaceId),
          conditions,
        ),
      ...columns,
      orderBy: [desc(QBProductSync.createdAt)],
    })
  }

  /**
   * Get all the mapped products
   */
  async getAll(
    conditions?: WhereClause,
    returningFields?: (keyof typeof QBProductSync)[],
  ) {
    let columns = null
    if (returningFields?.length) {
      columns = buildReturningFields(QBProductSync, returningFields, true)
    }

    return await this.db.query.QBProductSync.findMany({
      where: (QBProductSync, { eq }) =>
        and(
          isNull(QBProductSync.deletedAt),
          eq(QBProductSync.portalId, this.user.workspaceId),
          conditions,
        ),
      ...columns,
      orderBy: [desc(QBProductSync.createdAt)],
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

    const [product] = returningFields?.length
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

    const product = returningFields?.length
      ? await query.returning(
          buildReturningFields(QBProductSync, returningFields),
        )
      : await query.returning()

    return product
  }

  /**
   * Bulk update or create the map between product, price with QB item
   */
  async bulkDeleteCreateQBProduct(
    payload: QBProductCreateArraySchemaType,
    returningFields?: (keyof typeof QBProductSync)[],
  ): Promise<Partial<QBProductSelectSchemaType>[] | undefined> {
    const formattedPayload = payload.map((item) => {
      return {
        ...item,
        portalId: this.user.workspaceId,
      }
    })

    return await this.db.transaction(async (tx) => {
      await tx
        .delete(QBProductSync)
        .where(eq(QBProductSync.portalId, this.user.workspaceId))
      const query = tx.insert(QBProductSync).values(formattedPayload)
      const product = returningFields?.length
        ? await query.returning(
            buildReturningFields(QBProductSync, returningFields),
          )
        : await query.returning()
      return product
    })
  }

  async updateQBProduct(
    payload: QBProductUpdateSchemaType,
    conditions: WhereClause,
    returningFields?: (keyof typeof QBProductSync)[],
  ) {
    const parsedInsertPayload = QBProductUpdateSchema.parse(payload)

    const query = this.db
      .update(QBProductSync)
      .set(parsedInsertPayload)
      .where(conditions)

    const [product] = returningFields?.length
      ? await query.returning(
          buildReturningFields(QBProductSync, returningFields),
        )
      : await query.returning()

    return product
  }

  async updateOrCreateQBProduct(
    payload: QBProductCreateSchemaType,
    conditions: WhereClause,
  ) {
    const existingProduct = await this.getOne(conditions)

    if (existingProduct) {
      await this.updateQBProduct(payload, conditions)
    } else {
      await this.createQBProduct(payload)
    }
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

  async getFlatMapforAProduct(product: ProductResponse, copilot: CopilotAPI) {
    const prices = await copilot.getPrices(product.id)
    return (prices?.data ?? [])
      .map((price) => ({
        ...product,
        description: convert(product.description),
        priceId: price.id,
        amount: price.amount,
        type: price.type,
        interval: price.interval,
        intervalCount: price.intervalCount,
        currency: price.currency,
      }))
      .sort((a, b) => a.amount - b.amount) // sort by amount in asc order
  }

  async getFlattenProductList(
    limit: number,
    nextToken?: string,
  ): Promise<ProductFlattenArrayResponseType> {
    // get all the products from copilot
    const copilot = new CopilotAPI(this.user.token)
    const products = await copilot.getProducts(undefined, nextToken, limit)
    let flattenProductsPrice: ProductFlattenArrayResponseType = {
      products: [],
    }
    const flatmapProductPrice = []
    if (products?.data) {
      for (const product of products.data) {
        flatmapProductPrice.push(
          bottleneck.schedule(() => {
            return this.getFlatMapforAProduct(product, copilot)
          }),
        )
      }
      flattenProductsPrice = {
        products: (await Promise.all(flatmapProductPrice)).flat(),
      }
    }

    return flattenProductsPrice
  }

  /**
   * Updates the cached product list in redis
   */
  async webhookProductUpdated(
    resource: ProductUpdatedResponseType,
    qbTokenInfo: IntuitAPITokensType,
  ): Promise<void> {
    const productResource = resource.data

    // 01. get all the mapped product ids with qb id
    const mappedConditions =
      (not(isNull(QBProductSync.qbItemId)),
      not(isNull(QBProductSync.qbSyncToken)))

    const mappedProducts = await this.getAllByProductId(
      productResource.id,
      mappedConditions,
      ['id', 'qbItemId', 'qbSyncToken', 'name', 'description', 'unitPrice'],
    )

    if (!mappedProducts || !mappedProducts.length) {
      console.info(
        'WebhookService#webhookProductUpdated | No mapped products found',
      )
      return
    }

    if (qbTokenInfo.accessToken === '') {
      throw new APIError(httpStatus.UNAUTHORIZED, 'Refresh token is expired')
    }

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
            Id: z.string().parse(product.qbItemId),
            SyncToken: z.string().parse(product.qbSyncToken),
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
          await this.updateQBProduct(mapUpdatePayload, whereConditions)

          await this.logSync(
            productResource.id,
            itemRes.Item.Id,
            EventType.UPDATED,
            {
              productName: productResource.name,
              productPrice: product.unitPrice,
              qbItemName: product.name,
            },
          )
        }
      }),
    )
  }

  async webhookProductCreated(
    resource: ProductCreatedResponseType,
    qbTokenInfo: IntuitAPITokensType,
  ): Promise<void> {
    const productResource = resource.data
    const intuitApi = new IntuitAPI(qbTokenInfo)
    const productDescription = convert(productResource.description)

    // 01. get all unmapped by product id
    const mappedConditions =
      (isNull(QBProductSync.qbItemId), isNull(QBProductSync.qbSyncToken))

    const mappedProducts = await this.getAllByProductId(
      productResource.id,
      mappedConditions,
      ['id', 'unitPrice'],
    )
    const latestMappedProduct = mappedProducts?.[0]
    if (latestMappedProduct) {
      const item = await this.createItemInQB(
        {
          productName: productResource.name,
          unitPrice: latestMappedProduct?.unitPrice
            ? Number(latestMappedProduct.unitPrice)
            : 0,
          incomeAccRefVal: qbTokenInfo.incomeAccountRef,
          productDescription,
        },
        intuitApi,
      )
      await this.updateQBProduct(
        {
          portalId: this.user.workspaceId,
          productId: productResource.id,
          priceId: latestMappedProduct?.priceId,
          name: productResource.name,
          description: productDescription,
          qbItemId: item.Id,
          qbSyncToken: item.SyncToken,
        },
        eq(QBProductSync.id, latestMappedProduct?.id),
      )

      await this.logSync(productResource.id, item.Id, EventType.CREATED, {
        productName: productResource.name,
        productPrice: latestMappedProduct.unitPrice,
        qbItemName: item.Name,
      })
    } else {
      await this.createQBProduct({
        portalId: this.user.workspaceId,
        productId: productResource.id,
        name: productResource.name,
        description: productDescription,
      })

      console.info(
        'WebhookService#webhookProductCreated | Product mapping done',
      )
    }
  }

  async webhookPriceCreated(
    resource: PriceCreatedResponseType,
    qbTokenInfo: IntuitAPITokensType,
  ): Promise<void> {
    const priceResource = resource.data
    const intuitApi = new IntuitAPI(qbTokenInfo)

    // 01. get all unmapped by product id
    const mappedConditions =
      (isNull(QBProductSync.qbItemId), isNull(QBProductSync.qbSyncToken))

    const mappedProducts = await this.getAllByProductId(
      priceResource.productId,
      mappedConditions,
      ['id', 'name', 'description'],
    )
    const latestMappedProduct = mappedProducts?.[0]
    if (latestMappedProduct) {
      const item = await this.createItemInQB(
        {
          productName: z.string().parse(latestMappedProduct.name),
          unitPrice: priceResource.amount,
          incomeAccRefVal: qbTokenInfo.incomeAccountRef,
          productDescription: latestMappedProduct.description || '',
        },
        intuitApi,
      )
      await this.updateQBProduct(
        {
          portalId: this.user.workspaceId,
          productId: priceResource.productId,
          priceId: priceResource.id,
          unitPrice: priceResource.amount.toFixed(2),
          qbItemId: item.Id,
          qbSyncToken: item.SyncToken,
        },
        eq(QBProductSync.id, latestMappedProduct?.id),
      )
      console.info('WebhookService#webhookPriceCreated | Product created in QB')

      await this.logSync(priceResource.productId, item.Id, EventType.CREATED, {
        productName: latestMappedProduct.name,
        productPrice: priceResource.amount.toFixed(2),
        qbItemName: item.Name,
      })
    } else {
      await this.createQBProduct({
        portalId: this.user.workspaceId,
        productId: priceResource.productId,
        priceId: priceResource.id,
        unitPrice: priceResource.amount.toFixed(2),
      })

      console.info('WebhookService#webhookPriceCreated | Product mapping done')
    }
  }

  async queryItemsFromQB(
    qbTokenInfo: IntuitAPITokensType,
    limit: number,
    columns: string[],
  ) {
    const intuitApi = new IntuitAPI(qbTokenInfo)
    return await intuitApi.getAllItems(limit, columns)
  }

  async formatAndSyncProductLogs(payload: ProductChangedItemReferenceType[]) {
    await Promise.all(
      payload.map(async (item) => {
        const copilotId = item.id

        const payload: QBSyncLogCreateSchemaType = {
          portalId: this.user.workspaceId,
          entityType: EntityType.PRODUCT,
          eventType: EventType.UNMAPPED,
          status: LogStatus.INFO,
          copilotId,
          syncAt: dayjs().toDate(),
          quickbooksId: item.qbItem?.id || null,
          qbItemName: item.qbItem?.name || null,
          productName: item.name,
          productPrice: item.numericPrice.toFixed(2),
        }
        if (!item.isExcluded) {
          payload.eventType = EventType.MAPPED
          payload.status = LogStatus.SUCCESS
        }
        const conditions = and(
          eq(QBSyncLog.copilotId, copilotId),
          eq(QBSyncLog.portalId, this.user.workspaceId),
          inArray(QBSyncLog.eventType, [EventType.MAPPED, EventType.UNMAPPED]),
        )
        return await this.syncLogService.updateOrCreateQBSyncLog(
          payload,
          true,
          conditions,
        )
      }),
    )
  }

  private async logSync(
    copilotId: string,
    quickbooksId: string,
    eventType: EventType,
    opts?: {
      productPrice: string | null
      qbItemName: string | null
      productName: string | null
    },
  ) {
    await this.syncLogService.updateOrCreateQBSyncLog({
      portalId: this.user.workspaceId,
      entityType: EntityType.PRODUCT,
      eventType,
      status: LogStatus.SUCCESS,
      copilotId,
      syncAt: dayjs().toDate(),
      quickbooksId,
      ...opts,
    })
  }
}
