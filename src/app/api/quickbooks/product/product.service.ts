import { BaseService } from '@/app/api/core/services/base.service'
import { QBItemType } from '@/app/api/core/types/product'
import { buildReturningFields } from '@/db/helper/drizzle.helper'
import {
  QBProductCreateSchema,
  QBProductCreateSchemaType,
  QBProductSync,
  QBProductSelectSchemaType,
} from '@/db/schema/qbProductSync'
import { CopilotAPI } from '@/utils/copilotAPI'
import IntuitAPI from '@/utils/intuitAPI'
import { and, isNull } from 'drizzle-orm'

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

  async createQBProduct(
    payload: QBProductCreateSchemaType,
    returningFields?: (keyof typeof QBProductSync)[],
  ) {
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

  async getFlattenProductList(limit: number, nextToken?: string) {
    // 1. get all the products from copilot
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

    return flattenProductsPrice
  }
}
