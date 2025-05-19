import APIError from '@/app/api/core/exceptions/api'
import User from '@/app/api/core/models/User.model'
import { BaseService } from '@/app/api/core/services/base.service'
import { getLatestActiveClient } from '@/app/api/quickbooks/invoice/invoice.helper'
import { ProductService } from '@/app/api/quickbooks/product/product.service'
import { buildReturningFields } from '@/db/helper/drizzle.helper'
import {
  QBInvoiceSync,
  QBInvoiceCreateSchema,
  QBInvoiceCreateSchemaType,
} from '@/db/schema/qbInvoiceSync'
import { QBNameValueSchemaType } from '@/type/dto/intuitAPI.dto'
import { InvoiceCreatedResponseType } from '@/type/dto/webhook.dto'
import { CopilotAPI } from '@/utils/copilotAPI'
import IntuitAPI, { IntuitAPITokensType } from '@/utils/intuitAPI'
import { and, isNull } from 'drizzle-orm'
import { convert } from 'html-to-text'
import httpStatus from 'http-status'

export class InvoiceService extends BaseService {
  private copilot: CopilotAPI

  constructor(user: User) {
    super(user)
    this.copilot = new CopilotAPI(user.token)
  }

  async createQBInvoice(
    payload: QBInvoiceCreateSchemaType,
    returningFields?: (keyof typeof QBInvoiceSync)[],
  ) {
    const parsedInsertPayload = QBInvoiceCreateSchema.parse(payload)
    const query = this.db.insert(QBInvoiceSync).values(parsedInsertPayload)

    const [invoiceSync] =
      returningFields && returningFields.length > 0
        ? await query.returning(
            buildReturningFields(QBInvoiceSync, returningFields),
          )
        : await query

    return invoiceSync
  }

  async getInvoiceByNumber(
    invoiceNumber: string,
    returningFields?: (keyof typeof QBInvoiceSync)[],
  ) {
    let columns = null
    if (returningFields && returningFields.length > 0) {
      columns = buildReturningFields(QBInvoiceSync, returningFields, true)
    }

    return await this.db.query.QBInvoiceSync.findFirst({
      where: (QBTokens, { eq }) =>
        and(
          isNull(QBTokens.deletedAt),
          eq(QBInvoiceSync.invoiceNumber, invoiceNumber),
        ),
      ...(columns && { columns }),
    })
  }

  /**
   * Returns the invoice item reference (QB) for the given product and price
   *
   * @async
   * @param {string} productId
   * @param {string} priceId
   * @param {IntuitAPI} intuitApi
   * @returns {Promise<QBNameValueSchemaType>}
   */
  async getInvoiceItemRef(
    productId: string,
    priceId: string,
    intuitApi: IntuitAPI,
  ): Promise<QBNameValueSchemaType> {
    const productService = new ProductService(this.user)
    const mapping = await productService.getMappingByProductPriceId(
      productId,
      priceId,
    )
    if (mapping && mapping.qbItemId) {
      console.info('InvoiceService#getInvoiceItemRef | Product map found')
      return {
        value: mapping.qbItemId,
      }
    }

    // 2. create a new product in QB company
    const productInfo = await this.copilot.getProduct(productId)
    const priceInfo = await this.copilot.getPrice(priceId)
    if (!productInfo) {
      throw new APIError(httpStatus.NOT_FOUND, 'Product not found')
    }
    if (!priceInfo) {
      throw new APIError(httpStatus.NOT_FOUND, 'Price not found')
    }

    const productDescription = convert(productInfo.description)
    const incomeAccRefVal = intuitApi.tokens.incomeAccountRef

    // check if item exist with name in QB. If yes, map in mapping table
    let qbItem = await intuitApi.getAnItem(productInfo.name)

    if (!qbItem) {
      // create item in QB
      qbItem = await productService.createItemInQB(
        {
          productName: productInfo.name,
          unitPrice: priceInfo.amount,
          incomeAccRefVal,
          productDescription,
        },
        intuitApi,
      )
    }

    // create a new product mapping in qb_product_sync table
    const productMappingPayload = {
      portalId: this.user.workspaceId,
      productId: productId,
      priceId: priceId,
      qbItemId: qbItem.Id,
      qbSyncToken: qbItem.SyncToken,
    }
    await productService.createQBProduct(productMappingPayload)

    return { value: qbItem.Id }
  }

  /**
   * This function is executed when invoice.created event is triggered
   * Handles the invoice creation in QuickBooks
   *
   * @async
   * @param {InvoiceCreatedResponseType} payload
   * @param {IntuitAPITokensType} qbTokenInfo
   * @returns {Promise<void>}
   */
  async webhookInvoiceCreated(
    payload: InvoiceCreatedResponseType,
    qbTokenInfo: IntuitAPITokensType,
  ): Promise<void> {
    const invoiceResource = payload.data

    // 1. get client (retrieve receipentId from invoice resource). Copilot: Retrieve client. If not found, retrieve company and get first client from the company
    let client = await this.copilot.getClient(invoiceResource.recipientId)

    let company
    if (!client) {
      company = await this.copilot.getCompany(invoiceResource.recipientId)

      if (!company) {
        console.info(
          'InvoiceService#handleInvoiceCreated | Could not retrieve client or company',
        )
        throw new APIError(
          httpStatus.NOT_FOUND,
          'Could not find client or company',
        )
      }

      const clients = await this.copilot.getClients({
        companyId: company.id,
      })

      if (!clients?.data || clients.data.length === 0) {
        throw new APIError(httpStatus.NOT_FOUND, 'No clients found')
      }
      client = getLatestActiveClient(clients.data)
    }

    // 2. search client in qb using client's given name and family name
    const intuitApi = new IntuitAPI(qbTokenInfo)
    let customer = await intuitApi.getACustomer(
      client.givenName,
      client.familyName,
    )

    // 3. if not found, create a new client in the QB
    if (!customer) {
      if (!company) {
        // Case when client is retrieved directly from recipientId
        company = await this.copilot.getCompany(client.companyId)

        if (!company) {
          // Indicates company is not available in any case. This only logs as error and allows to create customer in QB since company name is optional
          console.error(
            'InvoiceService#handleInvoiceCreated | Could not retrieve company for client = ',
            client.id,
          )
        }
      }

      // Create a new customer in QB
      const customerPayload = {
        GivenName: client.givenName,
        FamilyName: client.familyName,
        CompanyName: company?.name,
        PrimaryEmailAddr: {
          Address: client.email,
        },
      }

      const customerRes = await intuitApi.createCustomer(customerPayload)
      customer = customerRes.Customer

      if (!customer) {
        throw new APIError(httpStatus.BAD_REQUEST, 'Failed to create customer')
      }
    }

    // 4. prepare payload for invoice with lineItems
    const lineItems = await Promise.all(
      invoiceResource.lineItems.map(async (lineItem) => {
        const actualAmount = lineItem.amount / 100 // Convert to dollar. amount received in cents.

        let itemRef: QBNameValueSchemaType = {
          name: 'Services', // for one-off items
          value: '1',
        }
        if (lineItem.productId && lineItem.priceId) {
          itemRef = await this.getInvoiceItemRef(
            lineItem.productId,
            lineItem.priceId,
            intuitApi,
          )
        }
        return {
          DetailType: 'SalesItemLineDetail',
          Amount: actualAmount * lineItem.quantity,
          SalesItemLineDetail: {
            ItemRef: itemRef,
            Qty: lineItem.quantity,
            UnitPrice: actualAmount,
          },
          Description: lineItem.description,
        }
      }),
    )

    // 5. create invoice in QB
    const qbInvoicePayload = {
      Line: lineItems,
      CustomerRef: {
        value: customer.Id,
      },
    }

    const invoiceRes = await intuitApi.createInvoice(qbInvoicePayload)

    const invoicePayload = {
      portalId: qbTokenInfo.intuitRealmId,
      invoiceNumber: invoiceResource.number,
      qbDocNumber: invoiceRes.Invoice.DocNumber,
      qbInvoiceId: invoiceRes.Invoice.Id,
      qbSyncToken: invoiceRes.Invoice.SyncToken,
    }
    await this.createQBInvoice(invoicePayload)
  }
}
