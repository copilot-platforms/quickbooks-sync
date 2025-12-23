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
  ProductMappingSchemaType,
} from '@/db/schema/qbProductSync'
import { ProductResponse, WhereClause } from '@/type/common'
import { ProductFlattenArrayResponseType } from '@/type/dto/api.dto'
import { bottleneck } from '@/utils/bottleneck'
import { QBItemFullUpdatePayloadType } from '@/type/dto/intuitAPI.dto'
import {
  PriceCreatedResponseType,
  ProductUpdatedResponseType,
} from '@/type/dto/webhook.dto'
import { CopilotAPI } from '@/utils/copilotAPI'
import IntuitAPI, { IntuitAPITokensType } from '@/utils/intuitAPI'
import { and, count, desc, eq, inArray, isNull, not, sql } from 'drizzle-orm'
import { convert } from 'html-to-text'
import { z } from 'zod'
import { SyncLogService } from '@/app/api/quickbooks/syncLog/syncLog.service'
import { EntityType, EventType, LogStatus } from '@/app/api/core/types/log'
import dayjs from 'dayjs'
import APIError from '@/app/api/core/exceptions/api'
import httpStatus from 'http-status'
import { QBSyncLog, QBSyncLogCreateSchemaType } from '@/db/schema/qbSyncLogs'
import User from '@/app/api/core/models/User.model'
import { SettingService } from '@/app/api/quickbooks/setting/setting.service'
import { replaceBeforeParens, replaceSpecialCharsForQB } from '@/utils/string'
import { AccountTypeObj } from '@/constant/qbConnection'
import { TokenService } from '@/app/api/quickbooks/token/token.service'

export type ProductSyncTokenResponse = {
  id: string
  syncToken: string
}

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
      orderBy: [desc(QBProductSync.createdAt)],
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

  async getProductCount(condition?: WhereClause) {
    const [result] = await this.db
      .select({
        count: count(QBProductSync.id),
      })
      .from(QBProductSync)
      .where(and(eq(QBProductSync.portalId, this.user.workspaceId), condition))

    return result.count
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
   * On intial save, save all flatten products. If mapped, we include and if not, those are excluded
   * On every save after that, we update the record on the basis of productId and priceId
   */
  async handleProductMap(
    body: ProductMappingSchemaType,
    returningFields?: (keyof typeof QBProductSync)[],
  ) {
    const { mappingItems, changedItemReference } = body
    const settingService = new SettingService(this.user)
    const setting = await settingService.getOneByPortalId([
      'initialProductSettingMap',
    ])

    return await this.db.transaction(async (tx) => {
      this.setTransaction(tx)

      if (!setting?.initialProductSettingMap) {
        const formattedPayload = mappingItems.map((item) => {
          return {
            ...item,
            portalId: this.user.workspaceId,
          }
        })
        const query = this.db.insert(QBProductSync).values(formattedPayload)
        const products = returningFields?.length
          ? await query.returning(
              buildReturningFields(QBProductSync, returningFields),
            )
          : await query.returning()
        return products
      }

      if (changedItemReference.length > 0) {
        await Promise.all(
          changedItemReference?.map(async (item) => {
            const payload = {
              portalId: this.user.workspaceId,
              productId: item.id,
              priceId: item.priceId,
              name: item.isExcluded ? null : item.qbItem?.name,
              description: item.isExcluded ? null : item.qbItem?.description,
              qbItemId: item.isExcluded ? null : item.qbItem?.id,
              qbSyncToken: item.isExcluded ? null : item.qbItem?.syncToken,
              copilotName: item.name,
              unitPrice: item.isExcluded
                ? null
                : item.qbItem?.numericPrice.toString(),
              copilotUnitPrice: item.numericPrice.toFixed(),
              isExcluded: item.isExcluded,
            }
            const conditions = and(
              eq(QBProductSync.portalId, this.user.workspaceId),
              eq(QBProductSync.productId, item.id),
              eq(QBProductSync.priceId, item.priceId),
            ) as WhereClause
            await this.updateOrCreateQBProduct(payload, conditions)
          }),
        )
      }

      this.unsetTransaction()
      return await this.getAll()
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
    taxable: boolean = true,
  ) {
    // create item in QB
    const qbItemPayload = {
      Name: opts.productName,
      UnitPrice: opts.unitPrice / 100,
      IncomeAccountRef: {
        value: opts.incomeAccRefVal, // required to enable sales in QB company
      },
      Type: QBItemType.SERVICE,
      Taxable: taxable, // to enable/disable tax for the product
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
      [
        'id',
        'qbItemId',
        'qbSyncToken',
        'name',
        'description',
        'unitPrice',
        'copilotName',
      ],
    )

    if (!mappedProducts || !mappedProducts.length) {
      console.info(
        'WebhookService#webhookProductUpdated | No mapped products found',
      )
      return
    }

    const updatedItems: Record<string, string> = {} // map to prevent multiple updates of same product map
    const itemNames: string[] = [] // list to update the item name. If updating item has same Item name, add itemCount to the name
    let itemCount = 0

    for (const product of mappedProducts) {
      const qbItemId = z.string().parse(product.qbItemId)
      const productId = z.string().parse(product.productId)

      // check if item is already updated
      if (productId in updatedItems && updatedItems[productId] === qbItemId) {
        console.info(
          `WebhookService#webhookProductUpdated | Item already updated in QB with Id = ${qbItemId}`,
        )
        continue
      }

      // 02. track change and sparse update the each item
      if (
        productResource.name !== product.copilotName ||
        productResource.description !== product.description
      ) {
        console.info(
          `WebhookService#webhookProductUpdated | Update item in QB for QB Id = ${qbItemId}`,
        )
        let qbItemName = replaceSpecialCharsForQB(
          product.name
            ? replaceBeforeParens(product.name, productResource.name)
            : productResource.name,
        )

        // If item name is same, add itemCount to the name
        if (itemNames.includes(qbItemName)) qbItemName += ` (${itemCount})`

        let productDescription = ''
        if (productResource.description) {
          productDescription = convert(productResource.description)
        }

        const intuitApi = new IntuitAPI(qbTokenInfo)
        // update sync token in product sync table
        const updateRes = await this.updateProductSyncToken({
          qbItemId,
          intuitApi,
        })

        if (!updateRes) {
          console.info(
            `ProductService#webhookProductUpdated. Returning early as product not found for Id ${qbItemId} in QuickBooks.`,
          )
          return
        }

        const { syncToken } = updateRes
        const tokenService = new TokenService(this.user)
        const incomeAccountRef = await tokenService.checkAndUpdateAccountStatus(
          AccountTypeObj.Income,
          qbTokenInfo.intuitRealmId,
          intuitApi,
          qbTokenInfo.incomeAccountRef,
        )

        const fullUpdatePayload: QBItemFullUpdatePayloadType = {
          Id: qbItemId,
          SyncToken: syncToken,
          Name: qbItemName,
          ...(productDescription && { Description: productDescription }),
          ...(product.unitPrice
            ? { UnitPrice: parseFloat(product.unitPrice) / 100 }
            : {}),
          IncomeAccountRef: {
            value: z.string().parse(incomeAccountRef),
          },
          Taxable: true,
          Type: QBItemType.SERVICE,
        }

        const itemRes = await intuitApi.itemFullUpdate(fullUpdatePayload)

        // update the product map in db
        const mapUpdatePayload = {
          qbSyncToken: itemRes.Item.SyncToken,
          name: qbItemName,
          copilotName: productResource.name,
          description: productDescription,
        }
        const whereConditions = eq(QBProductSync.qbItemId, qbItemId)
        await this.updateQBProduct(mapUpdatePayload, whereConditions)

        // update states
        updatedItems[productId] = qbItemId
        itemNames.push(qbItemName)
        itemCount++

        await this.logSync(
          productResource.id,
          itemRes.Item.Id,
          EventType.UPDATED,
          {
            productName: productResource.name,
            qbItemName: itemRes.Item.Name,
          },
        )
      }
    }
  }

  // handles product created
  async webhookPriceCreated(
    resource: PriceCreatedResponseType,
    qbTokenInfo: IntuitAPITokensType,
  ): Promise<void> {
    const priceResource = resource.data
    const intuitApi = new IntuitAPI(qbTokenInfo)

    await this.db.transaction(async (tx) => {
      this.setTransaction(tx)

      // 01. get all unmapped by product id
      const mappedProducts: QBProductSelectSchemaType[] | undefined =
        await this.getAllByProductId(priceResource.productId, undefined, [
          'id',
          'productId',
          'priceId',
        ])

      // total products with the same product id
      const itemsCount = mappedProducts?.length

      // filter out with priceId
      const productWithPriceCount = mappedProducts?.filter(
        (product) => product.priceId === priceResource.id,
      ).length

      if (productWithPriceCount && productWithPriceCount > 0) {
        console.info('Product already mapped with price')
        return
      }

      // get product from copilot
      const copilot = new CopilotAPI(this.user.token)
      const copilotProduct = await copilot.getProduct(priceResource.productId)

      if (!copilotProduct) {
        throw new APIError(
          httpStatus.NOT_FOUND,
          'Product not found. Id: ' + priceResource.productId,
        )
      }

      const qbItemName = replaceSpecialCharsForQB(
        itemsCount && itemsCount > 0
          ? `${copilotProduct.name} (${itemsCount})`
          : copilotProduct.name,
      )
      const productDescription = convert(copilotProduct.description)

      const tokenService = new TokenService(this.user)
      const incomeAccountRef = await tokenService.checkAndUpdateAccountStatus(
        AccountTypeObj.Income,
        qbTokenInfo.intuitRealmId,
        intuitApi,
        qbTokenInfo.incomeAccountRef,
      )
      // create item in QB
      const item = await this.createItemInQB(
        {
          productName: z.string().parse(qbItemName),
          unitPrice: priceResource.amount,
          incomeAccRefVal: z.string().parse(incomeAccountRef),
          productDescription,
        },
        intuitApi,
      )

      // map product and price
      await this.createQBProduct({
        portalId: this.user.workspaceId,
        productId: priceResource.productId,
        priceId: priceResource.id,
        unitPrice: priceResource.amount.toFixed(2),
        qbItemId: item.Id,
        qbSyncToken: item.SyncToken,
        name: qbItemName,
        copilotName: copilotProduct.name,
        description: productDescription,
      })

      console.info('WebhookService#webhookPriceCreated | Product created in QB')
      await this.logSync(priceResource.productId, item.Id, EventType.CREATED, {
        productName: copilotProduct.name,
        productPrice: priceResource.amount.toFixed(2),
        qbItemName: item.Name,
        copilotPriceId: priceResource.id,
      })

      this.unsetTransaction()
    })
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
          conditions,
        )
      }),
    )
  }

  private async logSync(
    copilotId: string,
    quickbooksId: string,
    eventType: EventType,
    opts: {
      copilotPriceId?: string
      qbItemName: string | null
      productName: string | null
      productPrice?: string
    },
  ) {
    const conditions = [
      eq(QBSyncLog.portalId, this.user.workspaceId),
      eventType === EventType.UPDATED
        ? (eq(QBSyncLog.copilotId, copilotId), // product update should be reflected to all the products with multiple prices
          eq(QBSyncLog.status, LogStatus.FAILED))
        : eq(QBSyncLog.copilotPriceId, z.string().parse(opts.copilotPriceId)), // product create should have different price Id,
    ].filter(Boolean)

    await this.syncLogService.updateOrCreateQBSyncLog(
      {
        portalId: this.user.workspaceId,
        entityType: EntityType.PRODUCT,
        eventType,
        status: LogStatus.SUCCESS,
        copilotId,
        syncAt: dayjs().toDate(),
        quickbooksId,
        errorMessage: null,
        ...opts,
      },
      and(...conditions),
    )
  }

  async updateProductSyncToken({
    qbItemId,
    intuitApi,
    updateMappingTable = true,
  }: {
    qbItemId: string
    intuitApi: IntuitAPI
    updateMappingTable?: boolean
  }): Promise<ProductSyncTokenResponse | undefined> {
    console.info(
      'ProductService#updateProductSyncToken. Updating sync token ...',
    )

    // 1. get item by ID
    let item = await intuitApi.getAnItem(undefined, qbItemId, true)

    // if no item found, remove mapping
    if (!item) {
      console.info(
        `ProductService#updateProductSyncToken. Item not found for Id ${qbItemId} in QuickBooks. Unmapping the product...`,
      )
      await this.unmapProducts(qbItemId)
      return
    } else if (!item.Active) {
      console.info(
        `ProductService#updateProductSyncToken. Item with Id ${qbItemId} is inactive. Making it active...`,
      )
      // if item is inactive, make it active
      const updateRes = await intuitApi.itemFullUpdate({
        Id: item.Id,
        SyncToken: item.SyncToken,
        Active: true,
        sparse: true,
      })
      item = updateRes.Item
    }

    if (updateMappingTable) {
      // 2. update sync token in item sync table
      await this.updateQBProduct(
        {
          qbSyncToken: item.SyncToken,
        },
        and(
          eq(QBProductSync.qbItemId, qbItemId),
          eq(QBProductSync.portalId, this.user.workspaceId),
        ) as WhereClause,
      )
    }

    console.info(
      'ProductService#updateProductSyncToken. Sync token updated ...',
    )
    return { id: item.Id, syncToken: item.SyncToken }
  }

  async unmapProducts(qbItemId: string): Promise<void> {
    await this.db
      .update(QBProductSync)
      .set({ qbItemId: null, qbSyncToken: null, name: null, unitPrice: null })
      .where(
        and(
          eq(QBProductSync.qbItemId, qbItemId),
          eq(QBProductSync.portalId, this.user.workspaceId),
        ),
      )
  }

  async ensureProductExistsAndSyncToken(
    productId: string,
    priceId: string,
    intuitAPI: IntuitAPI,
  ) {
    const map = await this.getMappingByProductPriceId(productId, priceId)

    if (!map) return
    if (!map.qbItemId || map.isExcluded) return map

    await this.updateProductSyncToken({
      qbItemId: map.qbItemId,
      intuitApi: intuitAPI,
    })
    return await this.getMappingByProductPriceId(productId, priceId)
  }
}
