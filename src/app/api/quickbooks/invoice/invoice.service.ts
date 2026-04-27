import APIError from '@/app/api/core/exceptions/api'
import User from '@/app/api/core/models/User.model'
import { BaseService } from '@/app/api/core/services/base.service'
import { InvoiceStatus, SyncableEntity } from '@/app/api/core/types/invoice'
import { EntityType, EventType, LogStatus } from '@/app/api/core/types/log'
import { CustomerService } from '@/app/api/quickbooks/customer/customer.service'
import { PaymentService } from '@/app/api/quickbooks/payment/payment.service'
import {
  ProductService,
  ProductSyncTokenResponse,
} from '@/app/api/quickbooks/product/product.service'
import { SettingService } from '@/app/api/quickbooks/setting/setting.service'
import { SyncLogService } from '@/app/api/quickbooks/syncLog/syncLog.service'
import { TokenService } from '@/app/api/quickbooks/token/token.service'
import { buildReturningFields } from '@/db/helper/drizzle.helper'
import { QBCustomers } from '@/db/schema/qbCustomers'
import {
  QBInvoiceCreateSchema,
  QBInvoiceCreateSchemaType,
  QBInvoiceSync,
  QBInvoiceUpdateSchema,
  QBInvoiceUpdateSchemaType,
} from '@/db/schema/qbInvoiceSync'
import { QBPortalConnection } from '@/db/schema/qbPortalConnections'
import { QBProductSync } from '@/db/schema/qbProductSync'
import { getPortalConnection } from '@/db/service/token.service'
import { QBSyncLog } from '@/db/schema/qbSyncLogs'
import { TransactionType, WhereClause } from '@/type/common'
import {
  QBCustomerSparseUpdatePayloadType,
  QBDestructiveInvoicePayloadSchema,
  QBNameValueSchemaType,
  QBInvoiceLineItemSchemaType,
} from '@/type/dto/intuitAPI.dto'
import {
  InvoiceCreatedResponseType,
  InvoiceDeletedResponse,
  InvoiceLineItemSchemaType,
  InvoiceResponseType,
  InvoiceVoidedResponse,
} from '@/type/dto/webhook.dto'
import { bottleneck } from '@/utils/bottleneck'
import { CopilotAPI } from '@/utils/copilotAPI'
import IntuitAPI, { IntuitAPITokensType } from '@/utils/intuitAPI'
import dayjs from 'dayjs'
import { and, eq, isNull } from 'drizzle-orm'
import { convert } from 'html-to-text'
import httpStatus from 'http-status'
import { z } from 'zod'
import { addSyncBreadcrumb } from '@/utils/sentry'
import { replaceSpecialCharsForQB, truncateForQB } from '@/utils/string'
import { AccountTypeObj } from '@/constant/qbConnection'

type OneOffItemType = {
  name?: string
  value: string
}

type InvoiceItemRefAndDescriptionType = {
  ref: QBNameValueSchemaType
  amount?: number
  productDescription?: string
  classRef?: QBNameValueSchemaType
}

export class InvoiceService extends BaseService {
  private copilot: CopilotAPI
  private syncLogService: SyncLogService

  constructor(user: User) {
    super(user)
    this.copilot = new CopilotAPI(user.token)
    this.syncLogService = new SyncLogService(user)
  }

  async createQBInvoice(
    payload: QBInvoiceCreateSchemaType,
    returningFields?: (keyof typeof QBInvoiceSync)[],
  ) {
    const parsedInsertPayload = QBInvoiceCreateSchema.parse(payload)
    // Concurrent webhook deliveries for the same invoice can race past the
    // app-level existence checks; the partial unique index on
    // (portal_id, invoice_number) WHERE deleted_at IS NULL is the durable
    // guard. Swallow conflicts here so the loser of the race no-ops.
    const query = this.db
      .insert(QBInvoiceSync)
      .values(parsedInsertPayload)
      .onConflictDoNothing({
        target: [QBInvoiceSync.portalId, QBInvoiceSync.invoiceNumber],
        where: isNull(QBInvoiceSync.deletedAt),
      })

    const [invoiceSync] = returningFields?.length
      ? await query.returning(
          buildReturningFields(QBInvoiceSync, returningFields),
        )
      : await query.returning()

    return invoiceSync
  }

  async updateQBInvoice(
    payload: QBInvoiceUpdateSchemaType,
    conditions: WhereClause,
    returningFields?: (keyof typeof QBInvoiceSync)[],
  ) {
    const parsedInsertPayload = QBInvoiceUpdateSchema.parse(payload)

    const query = this.db
      .update(QBInvoiceSync)
      .set(parsedInsertPayload)
      .where(conditions)

    const [invoiceSync] = returningFields?.length
      ? await query.returning(
          buildReturningFields(QBInvoiceSync, returningFields),
        )
      : await query.returning()

    return invoiceSync
  }

  async getInvoiceByNumber(
    invoiceNumber: string,
    returningFields?: (keyof typeof QBInvoiceSync)[],
  ) {
    let columns = null
    if (returningFields?.length) {
      columns = buildReturningFields(QBInvoiceSync, returningFields, true)
    }

    return await this.db.query.QBInvoiceSync.findFirst({
      where: (QBInvoiceSync, { eq }) =>
        and(
          isNull(QBInvoiceSync.deletedAt),
          eq(QBInvoiceSync.invoiceNumber, invoiceNumber),
          eq(QBInvoiceSync.portalId, this.user.workspaceId),
        ),
      with: {
        customer: true,
      },
      ...(columns && { columns }),
    })
  }

  private async handleItemAmount({
    copilotUnitPrice,
    priceId,
    mappingId,
    productService,
  }: {
    copilotUnitPrice: string | null
    priceId: string
    mappingId: string
    productService: ProductService
  }) {
    console.log(
      'Checking if Assembly item unit price is available and not zero.',
    )
    if (copilotUnitPrice && copilotUnitPrice !== '0') return copilotUnitPrice

    // fetch price amount from copilot if copilotUnitPrice is null
    console.info(
      'Copilot product price not found in mapping table. Fetching from copilot SDK',
    )
    const copilotPriceRes = await this.copilot.getPrice(priceId)
    if (!copilotPriceRes)
      throw new APIError(
        httpStatus.NOT_FOUND,
        'Price not found. Id: ' + priceId,
      )
    const itemAmount = copilotPriceRes.amount.toFixed()

    // update the price amount in our DB
    const priceUpdatePayload = {
      copilotUnitPrice: itemAmount,
    }
    const conditions = eq(QBProductSync.id, mappingId)

    await productService.updateQBProduct(priceUpdatePayload, conditions)
    console.info('Copilot unit price updated in mapping table')
    return itemAmount
  }

  /**
   * Returns the invoice item reference (QB) for the given product and price
   */
  private async getInvoiceItemRef(
    productId: string,
    priceId: string,
    intuitApi: IntuitAPI,
    oneOffItem: OneOffItemType,
    incomeAccRef: string,
  ): Promise<InvoiceItemRefAndDescriptionType> {
    const productService = new ProductService(this.user)

    // get product info from assembly
    const productInfo = await this.copilot.getProduct(productId)
    if (!productInfo) {
      throw new APIError(
        httpStatus.NOT_FOUND,
        'Product not found. Id: ' + productId,
      )
    }
    const productDescription = productInfo.description
      ? convert(productInfo.description)
      : ''

    const mapping = await productService.ensureProductExistsAndSyncToken(
      productId,
      priceId,
      intuitApi,
    )
    if (mapping) {
      if (mapping.isExcluded) {
        // if excluded, do not include in invoice and send as one-off item
        console.info('InvoiceService#getInvoiceItemRef | Product is excluded')
        return { ref: oneOffItem }
      }
      if (mapping.qbItemId) {
        console.info('InvoiceService#getInvoiceItemRef | Product map found')

        const itemAmount = await this.handleItemAmount({
          copilotUnitPrice: mapping.copilotUnitPrice,
          priceId,
          mappingId: mapping.id,
          productService,
        })

        const intuitItem = await intuitApi.getAnItem(
          undefined,
          mapping.qbItemId,
        )
        if (!intuitItem) return { ref: oneOffItem } // if item is not present in Intuit, return one-off item

        return {
          ref: { value: mapping.qbItemId },
          amount: parseFloat(itemAmount) / 100,
          productDescription,
          // classRef is optional. A classRef to the mapped QB item is checked every time for each item when creating an invoice.
          classRef: intuitItem.ClassRef,
        }
      }
    }

    // check if the flag is on for create new item
    const settingService = new SettingService(this.user)
    const setting = await settingService.getOneByPortalId([
      'createNewProductFlag',
    ])

    if (!setting?.createNewProductFlag) {
      console.info(
        'InvoiceService#getInvoiceItemRef | Create new product flag is false',
      )
      return { ref: oneOffItem }
    }

    // 2. create a new product in QB company
    const priceInfo = await this.copilot.getPrice(priceId)
    if (!priceInfo) {
      throw new APIError(httpStatus.NOT_FOUND, 'Price not found. Id:' + priceId)
    }
    const incomeAccRefVal = incomeAccRef

    // total products with the same product id
    const itemsCount = await productService.getProductCount(
      eq(QBProductSync.productId, productId),
    )

    const sanitizedName = replaceSpecialCharsForQB(productInfo.name)
    const newName =
      itemsCount > 0
        ? truncateForQB(sanitizedName, ` (${itemsCount})`)
        : truncateForQB(sanitizedName)

    // check if item exist with name in QB. If yes, map in mapping table
    let qbItem = await intuitApi.getAnItem(newName)

    if (!qbItem) {
      // create item in QB
      qbItem = await productService.createItemInQB(
        {
          productName: newName,
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
      productId,
      priceId,
      qbItemId: qbItem.Id,
      qbSyncToken: qbItem.SyncToken,
      copilotName: productInfo.name,
      name: qbItem.Name,
      description: productDescription,
      unitPrice: Number(priceInfo.amount).toFixed(), // decimal datatype expects string
      copilotUnitPrice: Number(priceInfo.amount).toFixed(), // decimal datatype expects string
    }
    const conditions = and(
      eq(QBProductSync.portalId, this.user.workspaceId),
      eq(QBProductSync.productId, productId),
      eq(QBProductSync.priceId, priceId),
    ) as WhereClause
    await productService.updateOrCreateQBProduct(
      productMappingPayload,
      conditions,
    )
    const syncLogPayload = {
      portalId: this.user.workspaceId,
      entityType: EntityType.PRODUCT,
      eventType: EventType.CREATED,
      status: LogStatus.SUCCESS,
      copilotId: productId,
      syncAt: dayjs().toDate(),
      quickbooksId: qbItem.Id,
      productName: productInfo.name,
      productPrice: Number(priceInfo.amount).toFixed(2),
      qbItemName: qbItem.Name,
      copilotPriceId: priceId,
      errorMessage: null,
    }

    // insert or update the sync log for product creation
    const syncLogConditions = and(
      eq(QBSyncLog.portalId, this.user.workspaceId),
      eq(QBSyncLog.copilotPriceId, priceId),
      eq(QBSyncLog.eventType, EventType.CREATED),
    ) as WhereClause
    await this.syncLogService.updateOrCreateQBSyncLog(
      syncLogPayload,
      syncLogConditions,
    )

    return {
      ref: { value: qbItem.Id },
      productDescription,
      classRef: qbItem.ClassRef,
    }
  }

  private async prepareLineItemPayload(
    lineItem: InvoiceLineItemSchemaType,
    intuitApi: IntuitAPI,
    oneOffItem: OneOffItemType,
    incomeAccRef: string,
  ) {
    const actualAmount = lineItem.amount / 100 // Convert to dollar. amount received in cents.

    let itemRef: InvoiceItemRefAndDescriptionType = {
      ref: oneOffItem,
      productDescription: lineItem.description,
    }

    if (lineItem.productId && lineItem.priceId) {
      itemRef = await this.getInvoiceItemRef(
        lineItem.productId,
        lineItem.priceId,
        intuitApi,
        oneOffItem,
        incomeAccRef,
      )
    }
    return {
      DetailType: 'SalesItemLineDetail',
      Amount: (itemRef.amount ?? actualAmount) * lineItem.quantity,
      SalesItemLineDetail: {
        ItemRef: itemRef.ref,
        Qty: lineItem.quantity,
        UnitPrice: itemRef.amount ?? actualAmount,
        TaxCodeRef: {
          // required to enable tax for the product.
          // Doc reference: https://developer.intuit.com/app/developer/qbo/docs/workflows/manage-sales-tax-for-us-locales#specifying-sales-tax
          value: 'TAX',
        },
        // ClassRef is optional. Only include when we have a value, otherwise QB will use the item's default class.
        // Doc reference: https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/class
        ...(itemRef.classRef && { ClassRef: itemRef.classRef }),
      },
      Description:
        typeof itemRef.productDescription === 'undefined'
          ? lineItem.description
          : itemRef.productDescription, // specific check for undefined type. Allow empty string
    }
  }

  async manageClientFeeRef(
    intuitService: IntuitAPI,
    incomeAccRefVal: string,
  ): Promise<string> {
    const productName = 'Assembly Fees paid by Client'
    const tokenService = new TokenService(this.user)

    const existingProduct = await intuitService.getAnItem(productName)
    let clientFeeRef
    if (existingProduct) {
      console.info("Item with name 'Assembly fee paid by Client' found in QB")
      clientFeeRef = existingProduct.Id
    } else {
      // create client fee as an item in QB
      console.info("Create 'Assembly fee paid by Client' as an item in QB")
      const productService = new ProductService(this.user)
      const qbItem = await productService.createItemInQB(
        {
          productName,
          unitPrice: 0,
          incomeAccRefVal,
        },
        intuitService,
        false, // flag that this item is non-taxable
      )
      clientFeeRef = qbItem.Id
    }

    // update clientFeeRef in our DB
    const updatedPayload = {
      clientFeeRef,
      updatedAt: dayjs().toDate(),
    }

    console.info("Store the 'Assembly fee paid by Client' item ref in DB")
    await tokenService.updateQBPortalConnection(
      updatedPayload,
      eq(QBPortalConnection.portalId, this.user.workspaceId),
      ['id'],
    )
    return clientFeeRef
  }

  async manageServiceItemRef(
    intuitService: IntuitAPI,
    incomeAccRefVal: string,
  ): Promise<string> {
    const productName = 'Assembly Service'
    const tokenService = new TokenService(this.user)

    const existingProduct = await intuitService.getAnItem(productName)
    let serviceItemRef
    if (existingProduct) {
      console.info(`Item with name '${productName}' found in QB`)
      serviceItemRef = existingProduct.Id
    } else {
      // create client fee as an item in QB
      console.info(`Create '${productName}' as an item in QB`)
      const productService = new ProductService(this.user)
      const qbItem = await productService.createItemInQB(
        {
          productName,
          unitPrice: 0,
          incomeAccRefVal,
        },
        intuitService,
      )
      serviceItemRef = qbItem.Id
    }

    // update serviceItemRef in our DB
    const updatedPayload = {
      serviceItemRef,
      updatedAt: dayjs().toDate(),
    }

    console.info(`Store the ${productName} item ref in DB`)
    await tokenService.updateQBPortalConnection(
      updatedPayload,
      eq(QBPortalConnection.portalId, this.user.workspaceId),
      ['id'],
    )
    return serviceItemRef
  }

  async handleFeePaidByClient(
    invoiceResource: InvoiceCreatedResponseType,
    intuitAPI: IntuitAPI,
    incomeAccRef: string,
  ): Promise<QBInvoiceLineItemSchemaType | undefined> {
    const invoice = invoiceResource.data
    // check invoice fee is paid by client
    const clientWithFee = invoice?.paymentMethodPreferences?.find(
      (preference) => preference.feePaidByClient === true,
    )
    if (clientWithFee) {
      console.info(
        'InvoiceService#handleFeePaidByClient | Fee is paid by Client',
      )
      const currentPortal = await getPortalConnection(this.user.workspaceId)
      let clientFeeRef = currentPortal?.clientFeeRef
      if (clientFeeRef) {
        const productService = new ProductService(this.user)
        await productService.updateProductSyncToken({
          qbItemId: clientFeeRef,
          intuitApi: intuitAPI,
          updateMappingTable: false,
        })
      } else
        clientFeeRef = await this.manageClientFeeRef(intuitAPI, incomeAccRef) // manage client fee ref (create new item in QB and store it into our DB)

      // get payment via invoice id
      const payments = await this.copilot.getPayments(invoice.id)
      if (!payments || !payments.data) return

      const feeAmount =
        payments.data.reduce((acc, payment) => {
          if (!!payment.feeAmount?.paidByClient) {
            return acc + payment.feeAmount.paidByClient
          }
          return acc
        }, 0) / 100 // convert to dollar
      return {
        DetailType: 'SalesItemLineDetail',
        Amount: feeAmount,
        SalesItemLineDetail: {
          ItemRef: { value: clientFeeRef },
          Qty: 1,
          UnitPrice: feeAmount,
        },
      }
    }
  }

  async handleServiceItem(intuitAPI: IntuitAPI, incomeAccRef: string) {
    let serviceItemRef = this.user.qbConnection?.serviceItemRef
    let serviceItem: ProductSyncTokenResponse | undefined
    if (serviceItemRef) {
      // check if the service item is active or not. If not, make it active
      const productService = new ProductService(this.user)
      serviceItem = await productService.updateProductSyncToken({
        qbItemId: serviceItemRef,
        intuitApi: intuitAPI,
      })
    }

    if (!serviceItemRef || !serviceItem?.id) {
      serviceItemRef = await this.manageServiceItemRef(intuitAPI, incomeAccRef)
    }
    return { value: serviceItemRef }
  }

  /**
   * This function is executed when invoice.created event is triggered
   * Handles the invoice creation in QuickBooks
   */
  async webhookInvoiceCreated(
    payload: InvoiceCreatedResponseType,
    qbTokenInfo: IntuitAPITokensType,
  ): Promise<void> {
    const invoiceResource = payload.data
    addSyncBreadcrumb('Invoice creation started', {
      invoiceNumber: invoiceResource.number,
      portalId: this.user.workspaceId,
    })

    // Check if the invoice with ID already exists in the db. This check is done in this function as it is also called from re-sync failed function
    const existingInvoice = await this.getInvoiceByNumber(
      invoiceResource.number,
      ['id'],
    )

    // Do not store if invoice already exists
    if (existingInvoice) {
      console.info(
        'InvoiceService#handleWebhookEvent#exists | Invoice already exists in the db',
      )

      return
    }

    const intuitApiService = new IntuitAPI(qbTokenInfo)

    // Check if invoice already exists in QBO (e.g. manually created) and map it if so
    const mappedFromQBO = await this.findOrMapInvoiceFromQBO({
      invoiceNumber: invoiceResource.number,
      copilotInvoiceId: invoiceResource.id,
      clientId: invoiceResource.clientId,
      companyId: invoiceResource.companyId,
      status: invoiceResource.status,
      total: invoiceResource.total,
      taxAmount: invoiceResource.taxAmount,
      intuitApi: intuitApiService,
    })
    if (mappedFromQBO) {
      console.info(
        'InvoiceService#webhookInvoiceCreated | Invoice found in QBO and mapped. Skipping creation.',
      )
      return
    }
    const incomeAccRef = await this.handleIncomeAccountRef(
      qbTokenInfo,
      intuitApiService,
    )

    const customerService = new CustomerService(this.user)
    // 1. get client (retrieve receipentId from invoice resource). Copilot: Retrieve client. If not found, retrieve company and get first client from the company
    const { recipientInfo, companyInfo } =
      await customerService.getRecipientInfo({
        clientId: invoiceResource.clientId,
        companyId: invoiceResource.companyId,
      })

    // 2. search client in our mapping table
    const existingCustomer =
      await customerService.ensureCustomerExistsAndSyncToken(
        recipientInfo.clientCompanyId,
        recipientInfo.type,
        intuitApiService,
      )

    addSyncBreadcrumb('Customer resolved', {
      existingMapping: !!existingCustomer,
    })

    let customer,
      existingCustomerMapId = existingCustomer?.id
    if (!existingCustomer) {
      const customerWName = await customerService.findOrCreateCustomer({
        intuitApiService,
        recipientInfo,
        companyInfo,
        invoiceResource,
      })
      customer = customerWName.customer
      existingCustomerMapId = customerWName.customerSyncId
    } else {
      console.info('InvoiceService#webhookInvoiceCreated. Customer exists.')

      // update the customer in qb
      const sparseUpdatePayload: Omit<
        QBCustomerSparseUpdatePayloadType,
        'Id' | 'SyncToken' | 'sparse'
      > = {}

      if (existingCustomer.email !== recipientInfo.email) {
        sparseUpdatePayload.PrimaryEmailAddr = {
          Address: recipientInfo.email,
        }
      }
      // if (existingCustomer.displayName !== recipientInfo.displayName) {
      //   // DisplayName = GivenName + FamilyName + CompanyName (if exists)
      //   sparseUpdatePayload.DisplayName = replaceSpecialCharsForQB(
      //     recipientInfo.displayName,
      //   )
      //   sparseUpdatePayload.GivenName = replaceSpecialCharsForQB(
      //     recipientInfo.givenName,
      //   )
      //   sparseUpdatePayload.FamilyName = replaceSpecialCharsForQB(
      //     recipientInfo.familyName,
      //   )
      //   sparseUpdatePayload.CompanyName =
      //     companyInfo && replaceSpecialCharsForQB(companyInfo.name)
      // }

      if (existingCustomer.companyName !== companyInfo?.name) {
        sparseUpdatePayload.CompanyName =
          companyInfo && replaceSpecialCharsForQB(companyInfo.name)
      }

      if (Object.keys(sparseUpdatePayload).length > 0) {
        const customerSparsePayload = {
          ...sparseUpdatePayload,
          Id: existingCustomer.qbCustomerId,
          SyncToken: existingCustomer.qbSyncToken,
          BillAddr: {
            Line1: replaceSpecialCharsForQB(
              `${existingCustomer.givenName} ${existingCustomer.familyName}`,
            ),
            Line2: companyInfo && replaceSpecialCharsForQB(companyInfo.name),
          },
          sparse: true as const,
        }

        customer = await intuitApiService.customerSparseUpdate(
          customerSparsePayload,
        )

        // update the customer map in our table
        const customerSyncUpPayload = {
          givenName: recipientInfo.givenName,
          familyName: recipientInfo.familyName,
          displayName: recipientInfo.displayName,
          email: recipientInfo.email,
          companyName: companyInfo?.name,
          qbSyncToken: customer.SyncToken,
        }
        const updateCondition = eq(QBCustomers.id, existingCustomer.id)

        await customerService.updateQBCustomer(
          customerSyncUpPayload,
          updateCondition,
        )
      }
    }

    // Check if service item ref ID is present in our DB. If not create new
    // in QB and store the id in our DB
    const oneOffItem = await this.handleServiceItem(
      intuitApiService,
      incomeAccRef,
    )

    // bottleneck implementation (rate limiting)
    const lineItemPromises = []
    for (const lineItem of invoiceResource.lineItems) {
      lineItemPromises.push(
        bottleneck.schedule(() => {
          return this.prepareLineItemPayload(
            lineItem,
            intuitApiService,
            oneOffItem,
            incomeAccRef,
          )
        }),
      )
    }

    const lineItems: QBInvoiceLineItemSchemaType[] =
      await Promise.all(lineItemPromises)

    const subtotal = lineItems.reduce((acc, item) => {
      // calculate the actual tax amount from the lineItems. Not using invoiceResource amount directly as the amount for mapped items can be different (mapped QB amount).
      return acc + item.Amount
    }, 0)
    let actualTotalAmount = subtotal
    const totalTax =
      (invoiceResource.taxPercentage
        ? parseFloat(
            ((subtotal * invoiceResource.taxPercentage) / 100).toFixed(2),
          )
        : invoiceResource.taxAmount) || 0

    // check if invoice is paid. This needs to be done after actualTotalAmount and totalTax calculation to avoid miscalculation
    if (invoiceResource.status === InvoiceStatus.PAID) {
      const clientFeeLineItem = await this.handleFeePaidByClient(
        payload,
        intuitApiService,
        incomeAccRef,
      )
      if (clientFeeLineItem) {
        lineItems.push(clientFeeLineItem)
        actualTotalAmount += clientFeeLineItem.Amount
      }
    }

    // 5. create invoice in QB
    const customerRefValue: string =
      customer?.Id || existingCustomer?.qbCustomerId
    const qbInvoicePayload = {
      Line: lineItems,
      CustomerRef: {
        value: customerRefValue,
      },
      DocNumber: invoiceResource.number, // copilot invoice number as DocNumber
      // include tax and dates
      TxnTaxDetail: {
        TotalTax: totalTax,
      },
      ...(invoiceResource?.sentDate && {
        TxnDate: dayjs(invoiceResource.sentDate).format('YYYY/MM/DD'), // Valid date format for TxnDate is YYYY/MM/DD. For more info: https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/invoice#the-invoice-object
      }),
      ...(invoiceResource?.dueDate && {
        DueDate: dayjs(invoiceResource.dueDate).format('YYYY-MM-DD'), // the date format for due date follows XML Schema standard (YYYY-MM-DD). For more info: https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/invoice#the-invoice-object
      }),
      BillEmail: {
        Address: customer?.PrimaryEmailAddr?.Address || existingCustomer?.email, // To add customer bill email in Invoice. Docs: https://help.developer.intuit.com/s/question/0D50f00005E4I5nCAF/customer-email-not-showing-on-invoice
      },
    }

    // 6. create invoice in QB
    addSyncBreadcrumb('Creating invoice in QBO', {
      invoiceNumber: invoiceResource.number,
    })
    const invoiceRes = await intuitApiService.createInvoice(qbInvoicePayload)

    const invoicePayload = {
      portalId: this.user.workspaceId,
      invoiceNumber: invoiceResource.number,
      qbInvoiceId: invoiceRes.Invoice.Id,
      qbSyncToken: invoiceRes.Invoice.SyncToken,
      recipientId: recipientInfo.recipientId,
      customerId: existingCustomerMapId, // foreign key to customer mapping
      status: invoiceResource.status,
    }
    await this.createQBInvoice(invoicePayload)

    // update/ create the record in sync log table
    const totalWithTax = actualTotalAmount + totalTax
    await this.logSync(
      invoiceResource.id,
      {
        qbInvoiceId: invoiceRes.Invoice.Id,
        invoiceNumber: invoiceResource.number,
      },
      EventType.CREATED,
      {
        amount: (totalWithTax * 100).toFixed(2),
        taxAmount: (totalTax * 100).toFixed(2), // convert to cents for logs
        customerName: recipientInfo.displayName,
        customerEmail: recipientInfo.email,
      },
    )

    /**
     * here, creates a payment if invoice is paid. "invoice.paid" hook can trigger before "invoice.created" hook
     * this can create issue as invoice is not found when "invoice.paid" hook is triggered
     */
    if (invoiceResource.status === InvoiceStatus.PAID) {
      const paymentService = new PaymentService(this.user)
      const qbPaymentPayload = {
        TotalAmt: totalWithTax,
        CustomerRef: {
          value: customerRefValue,
        },
        Line: [
          {
            Amount: totalWithTax,
            LinkedTxn: [
              {
                TxnId: invoiceRes.Invoice.Id,
                TxnType: TransactionType.INVOICE,
              },
            ],
          },
        ],
      }
      await paymentService.createPaymentAndSync(
        intuitApiService,
        qbPaymentPayload,
        {
          invoiceNumber: invoiceResource.number,
          invoiceId: invoiceResource.id,
          taxAmount: (totalTax * 100).toFixed(2),
        },
        {
          displayName: recipientInfo.displayName,
          email: recipientInfo?.email || null,
        },
      )
    }
  }

  async webhookInvoicePaid(
    payload: InvoiceResponseType,
    qbTokenInfo: IntuitAPITokensType,
  ): Promise<void> {
    addSyncBreadcrumb('Invoice paid flow started', {
      invoiceNumber: payload.data.number,
    })
    // 1. check if the status of invoice is already paid in sync table
    let invoiceSync = await this.getInvoiceByNumber(payload.data.number, [
      'id',
      'qbInvoiceId',
      'status',
      'customerId',
    ])

    if (!invoiceSync) {
      console.info(
        'InvoiceService#webhookInvoicePaid | Invoice not found in sync table. Attempting find-or-map from QBO...',
      )
      const intuitApi = new IntuitAPI(qbTokenInfo)
      const mappedInvoice = await this.findOrMapInvoiceFromQBO({
        invoiceNumber: payload.data.number,
        copilotInvoiceId: payload.data.id,
        clientId: payload.data.clientId,
        companyId: payload.data.companyId,
        status: payload.data.status,
        total: payload.data.total,
        taxAmount: payload.data.taxAmount,
        intuitApi,
      })
      if (!mappedInvoice) {
        throw new APIError(
          httpStatus.NOT_FOUND,
          `Invoice not found in sync table or QBO for paid event. Invoice number: ${payload.data.number}. Likely preceded by a failed CREATE sync.`,
        )
      }
      invoiceSync = mappedInvoice
    }

    // check if the entity invoice has successful event paid
    const syncLog = await this.syncLogService.getOneByCopilotIdAndEventType({
      copilotId: payload.data.id,
      eventType: EventType.PAID,
      entityType: EntityType.INVOICE,
    })

    if (syncLog?.status === LogStatus.SUCCESS) {
      console.info('InvoiceService#webhookInvoicePaid | Invoice already paid')
      return
    }

    // TODO: direct customer fetch with invoice.
    // 2. if not, create payment in QB, sync payment in payment sync table and change invoice status to paid
    if (!invoiceSync.customerId) {
      console.error('InvoiceService#webhookInvoicePaid | CustomerId not found')
      throw new APIError(
        httpStatus.INTERNAL_SERVER_ERROR,
        'CustomerId not found. Invoice number: ' + payload.data.number,
      )
    }
    const customerService = new CustomerService(this.user)
    const existingCustomer = await customerService.getCustomerById(
      invoiceSync.customerId,
      ['id', 'qbCustomerId', 'givenName', 'familyName', 'email', 'companyName'],
    )
    if (!existingCustomer) {
      console.error(
        'InvoiceService#webhookInvoicePaid | Customer mapping not found',
      )
      throw new APIError(
        httpStatus.INTERNAL_SERVER_ERROR,
        'Customer mapping not found. Invoice number: ' + payload.data.number,
      )
    }

    // get invoice sync log
    const invoiceLog = await this.syncLogService.getOneByCopilotIdAndEventType({
      copilotId: payload.data.id,
      eventType: EventType.CREATED,
      entityType: EntityType.INVOICE,
    })

    if (!invoiceLog) {
      console.error(
        'InvoiceService#webhookInvoicePaid | Invoice sync log not found',
      )
      throw Error('Invoice sync log not found')
    }

    const invoiceAmount = Number(z.string().parse(invoiceLog.amount)) / 100

    // Check if bank deposit fee flow is enabled — if so, route payment through Undeposited Funds
    const settingService = new SettingService(this.user)
    const setting = await settingService.getOneByPortalId([
      'absorbedFeeFlag',
      'bankDepositFeeFlag',
    ])
    const useBankDepositFlow =
      setting?.absorbedFeeFlag && setting?.bankDepositFeeFlag

    const intuitApi = new IntuitAPI(qbTokenInfo)

    let depositToAccountRef: { value: string } | undefined
    if (useBankDepositFlow) {
      const undepositedFundsRef = await intuitApi.getUndepositedFundsAccountId()
      depositToAccountRef = { value: undepositedFundsRef }
    }

    const qbPaymentPayload = {
      TotalAmt: invoiceAmount,
      CustomerRef: {
        value: existingCustomer.qbCustomerId,
      },
      ...(depositToAccountRef && {
        DepositToAccountRef: depositToAccountRef,
      }),
      Line: [
        {
          Amount: invoiceAmount,
          LinkedTxn: [
            {
              TxnId: z.string().parse(invoiceSync.qbInvoiceId), // this links payment to invoice docs reference: https://help.developer.intuit.com/s/question/0D54R00007Ot7ZXSAZ/linking-payment-to-invoice-through-api
              TxnType: TransactionType.INVOICE,
            },
          ],
        },
      ],
    }
    const paymentService = new PaymentService(this.user)

    const customerDisplayName =
      existingCustomer.givenName && existingCustomer.familyName
        ? `${existingCustomer.givenName} ${existingCustomer.familyName}`
        : existingCustomer.companyName

    const success = await paymentService.createPaymentAndSync(
      intuitApi,
      qbPaymentPayload,
      {
        invoiceNumber: payload.data.number,
        invoiceId: payload.data.id,
        taxAmount: invoiceLog.taxAmount
          ? z.string().parse(invoiceLog.taxAmount)
          : '0',
      },
      {
        displayName: customerDisplayName,
        email: existingCustomer.email,
      },
    )

    if (success) {
      await this.updateQBInvoice(
        {
          status: InvoiceStatus.PAID,
        },
        eq(QBInvoiceSync.id, invoiceSync.id),
        ['id'],
      )
    }
  }

  async webhookInvoiceVoided(
    payload: InvoiceVoidedResponse,
    qbTokenInfo: IntuitAPITokensType,
  ): Promise<void> {
    addSyncBreadcrumb('Invoice voided flow started', {
      invoiceNumber: payload.number,
    })
    // 1. check if the status of invoice is already paid in sync table
    let invoiceSync = await this.getInvoiceByNumber(payload.number, [
      'id',
      'qbInvoiceId',
      'status',
      'qbSyncToken',
      'invoiceNumber',
    ])

    if (!invoiceSync) {
      console.info(
        'InvoiceService#webhookInvoiceVoided | Invoice not found in sync table. Attempting find-or-map from QBO...',
      )
      const intuitApi = new IntuitAPI(qbTokenInfo)
      const mappedInvoice = await this.findOrMapInvoiceFromQBO({
        invoiceNumber: payload.number,
        copilotInvoiceId: payload.id,
        clientId: payload.clientId,
        companyId: payload.companyId,
        status: InvoiceStatus.OPEN,
        total: payload.total,
        intuitApi,
      })
      if (!mappedInvoice) {
        throw new APIError(
          httpStatus.NOT_FOUND,
          `Invoice not found in sync table or QBO for void event. Invoice number: ${payload.number}. Likely preceded by a failed CREATE sync.`,
        )
      }
      invoiceSync = mappedInvoice
    }

    if (invoiceSync.status !== InvoiceStatus.OPEN) {
      console.error(
        'InvoiceService#handleInvoiceVoided | Invoices void was requested for non-open record',
      )
      return // return early if invoice is not open
    }

    // get invoice sync log
    const invoiceLog = await this.syncLogService.getOneByCopilotIdAndEventType({
      copilotId: payload.id,
      eventType: EventType.CREATED,
      entityType: EntityType.INVOICE,
    })

    if (!invoiceLog) {
      console.error(
        'InvoiceService#webhookInvoicePaid | Invoice sync log not found',
      )
      throw Error('Invoice sync log not found')
    }

    // only implement void if invoice has open status
    const intuitApi = new IntuitAPI(qbTokenInfo)
    const voidPayload = {
      Id: invoiceSync.qbInvoiceId,
      SyncToken: invoiceSync.qbSyncToken,
    }
    const safeParsedPayload =
      QBDestructiveInvoicePayloadSchema.safeParse(voidPayload)

    if (!safeParsedPayload.success || !safeParsedPayload.data) {
      console.error(
        'InvoiceService#webhookInvoiceVoided | Could not parse invoice void payload',
      )
      throw new APIError(
        httpStatus.INTERNAL_SERVER_ERROR,
        'Could not parse invoice void payload. Invoice number: ' +
          payload.number,
      )
    }

    await intuitApi.voidInvoice(safeParsedPayload.data)
    const customerService = new CustomerService(this.user)
    const { recipientInfo } = await customerService.getRecipientInfo({
      clientId: payload.clientId,
      companyId: payload.companyId,
    })

    await Promise.all([
      this.updateQBInvoice(
        {
          status: InvoiceStatus.VOID,
        },
        eq(QBInvoiceSync.id, invoiceSync.id),
        ['id'],
      ),
      this.logSync(payload.id, invoiceSync, EventType.VOIDED, {
        amount: z.string().parse(invoiceLog.amount),
        taxAmount: invoiceLog.taxAmount
          ? z.string().parse(invoiceLog.taxAmount)
          : '0',
        customerName: recipientInfo.displayName,
        customerEmail: recipientInfo.email,
      }),
    ])
  }

  async handleInvoiceDeleted(
    payload: InvoiceDeletedResponse,
    qbTokenInfo: IntuitAPITokensType,
  ): Promise<void> {
    addSyncBreadcrumb('Invoice deleted flow started', {
      invoiceNumber: payload.number,
    })

    let syncedInvoice = await this.getInvoiceByNumber(payload.number, [
      'id',
      'qbInvoiceId',
      'status',
      'qbSyncToken',
      'invoiceNumber',
    ])

    // Check QBO for the invoice up front. QBO is the source of truth for whether
    // there's anything to delete; the local sync table is just a cache of the mapping.
    const intuitApi = new IntuitAPI(qbTokenInfo)
    const qbInvoice = await intuitApi.getInvoice(payload.number)

    if (!qbInvoice) {
      // Invoice doesn't exist in QBO (never synced or manually deleted there).
      // Soft-delete any prior sync logs, mark the local mapping (if any) as DELETED,
      // and record the DELETED event as pre-soft-deleted for audit.
      console.info(
        'InvoiceService#handleInvoiceDeleted | Invoice absent from QBO. Soft-deleting logs, marking local mapping as DELETED, and recording pre-soft-deleted DELETED event.',
      )
      try {
        await this.db.transaction(async (tx) => {
          this.setTransaction(tx)
          this.syncLogService.setTransaction(tx)
          const now = new Date()
          await this.syncLogService.softDeleteLogsByCopilotId(
            payload.id,
            EntityType.INVOICE,
            now,
          )
          if (syncedInvoice) {
            await this.updateQBInvoice(
              { status: InvoiceStatus.DELETED },
              eq(QBInvoiceSync.id, syncedInvoice.id),
              ['id'],
            )
          }
          await this.syncLogService.updateOrCreateQBSyncLog({
            portalId: this.user.workspaceId,
            entityType: EntityType.INVOICE,
            eventType: EventType.DELETED,
            status: LogStatus.SUCCESS,
            copilotId: payload.id,
            invoiceNumber: payload.number,
            amount: payload.total ? payload.total.toFixed(2) : undefined,
            syncAt: now,
            deletedAt: now,
          })
        })
      } finally {
        this.unsetTransaction()
        this.syncLogService.unsetTransaction()
      }
      return
    }

    // QBO has the invoice. Ensure we have a local mapping before deleting.
    if (!syncedInvoice) {
      console.info(
        'InvoiceService#handleInvoiceDeleted | Invoice in QBO but not in sync table. Mapping before delete.',
      )
      const mappedInvoice = await this.findOrMapInvoiceFromQBO({
        invoiceNumber: payload.number,
        copilotInvoiceId: payload.id,
        clientId: payload.clientId,
        companyId: payload.companyId,
        status: InvoiceStatus.VOID,
        total: payload.total,
        intuitApi,
        qbInvoice,
      })
      if (!mappedInvoice) {
        throw new APIError(
          httpStatus.INTERNAL_SERVER_ERROR,
          `Failed to map QBO invoice for delete. Invoice number: ${payload.number}`,
        )
      }
      syncedInvoice = mappedInvoice
    }

    // Copilot doesn't allow to delete invoice that are not voided. So, just log an error about possible edge cases without returning an error
    if (syncedInvoice.status !== InvoiceStatus.VOID) {
      console.error(
        'InvoiceService#handleInvoiceDeleted | Invoices delete was requested for non-voided record',
      )
      return // return early if invoice is not voided
    }

    // get invoice sync log
    const invoiceLog = await this.syncLogService.getOneByCopilotIdAndEventType({
      copilotId: payload.id,
      eventType: EventType.CREATED,
      entityType: EntityType.INVOICE,
    })

    if (!invoiceLog) {
      console.error(
        'InvoiceService#webhookInvoicePaid | Invoice sync log not found',
      )
      throw new Error('Invoice sync log not found')
    }

    const deletePayload = {
      Id: syncedInvoice.qbInvoiceId,
      SyncToken: syncedInvoice.qbSyncToken,
    }
    const safeParsedPayload =
      QBDestructiveInvoicePayloadSchema.safeParse(deletePayload)
    if (!safeParsedPayload.success) {
      console.error(
        'InvoiceService#handleInvoiceDeleted | Could not parse invoice delete payload',
      )
      throw new APIError(
        httpStatus.INTERNAL_SERVER_ERROR,
        'Could not parse invoice delete payload. Invoice number: ' +
          payload.number,
      )
    }

    const customerService = new CustomerService(this.user)
    const { recipientInfo } = await customerService.getRecipientInfo({
      clientId: payload.clientId,
      companyId: payload.companyId,
    })

    await intuitApi.deleteInvoice(safeParsedPayload.data)

    await Promise.all([
      this.updateQBInvoice(
        { status: InvoiceStatus.DELETED },
        eq(QBInvoiceSync.id, syncedInvoice.id),
        ['id'],
      ),
      this.logSync(payload.id, syncedInvoice, EventType.DELETED, {
        amount: z.string().parse(invoiceLog.amount),
        taxAmount: invoiceLog.taxAmount
          ? z.string().parse(invoiceLog.taxAmount)
          : '0',
        customerName: recipientInfo.displayName,
        customerEmail: recipientInfo.email,
      }),
    ])
  }

  private async logSync(
    copilotId: string,
    syncedInvoice: SyncableEntity,
    eventType: EventType,
    opts?: {
      amount?: string
      taxAmount?: string
      customerName?: string
      customerEmail?: string
      errorMessage?: string
    },
  ) {
    await this.syncLogService.updateOrCreateQBSyncLog({
      portalId: this.user.workspaceId,
      entityType: EntityType.INVOICE,
      eventType,
      status: LogStatus.SUCCESS,
      copilotId,
      syncAt: dayjs().toDate(),
      quickbooksId: syncedInvoice.qbInvoiceId,
      invoiceNumber: syncedInvoice.invoiceNumber,
      ...{ ...opts, errorMessage: opts?.errorMessage || null },
    })
  }

  private async handleIncomeAccountRef(
    qbTokenInfo: IntuitAPITokensType,
    intuitApiService: IntuitAPI,
  ) {
    const tokenService = new TokenService(this.user)
    const incomeAccountRef = await tokenService.checkAndUpdateAccountStatus(
      AccountTypeObj.Income,
      qbTokenInfo.intuitRealmId,
      intuitApiService,
      qbTokenInfo.incomeAccountRef,
    )
    return z.string().parse(incomeAccountRef)
  }

  async checkIfInvoiceExistsInQBO(
    invoiceResource: InvoiceCreatedResponseType,
    qbTokenInfo: IntuitAPITokensType,
  ): Promise<{ exists: boolean }> {
    console.info(
      'InvoiceService#checkIfInvoiceExistsInQBO | Checking if invoice exists in QBO',
    )
    const invoice = invoiceResource.data

    // Check local DB first to avoid unnecessary QBO API calls
    const existingMapping = await this.getInvoiceByNumber(invoice.number, [
      'id',
    ])
    if (existingMapping) {
      return { exists: true }
    }

    const intuitApi = new IntuitAPI(qbTokenInfo)
    const mapping = await this.findOrMapInvoiceFromQBO({
      invoiceNumber: invoice.number,
      copilotInvoiceId: invoice.id,
      clientId: invoice.clientId,
      companyId: invoice.companyId,
      status: invoice.status,
      total: invoice.lineItems[0]?.amount,
      taxAmount: invoice.taxAmount,
      intuitApi,
    })

    return { exists: mapping !== null }
  }

  async findOrMapInvoiceFromQBO(params: {
    invoiceNumber: string
    copilotInvoiceId: string
    clientId: string
    companyId: string
    status: InvoiceStatus
    total?: number
    taxAmount?: number | null
    intuitApi: IntuitAPI
    // Pre-fetched QBO invoice; when provided, skips the internal getInvoice lookup.
    qbInvoice?: Awaited<ReturnType<IntuitAPI['getInvoice']>>
  }) {
    const {
      invoiceNumber,
      copilotInvoiceId,
      clientId,
      companyId,
      status,
      total,
      taxAmount,
      intuitApi,
    } = params

    // 1. Query QBO for the invoice by DocNumber (unless caller already fetched it)
    const qbInvoice =
      params.qbInvoice ?? (await intuitApi.getInvoice(invoiceNumber))
    if (!qbInvoice) {
      console.info(
        'InvoiceService#findOrMapInvoiceFromQBO | Invoice not found in QBO',
      )
      return null
    }

    // 2. Re-check the local mapping. A concurrent webhook delivery may have
    // inserted the row while we were fetching from QBO; short-circuit to
    // avoid wasted customer/mapping work. The partial unique index closes
    // the remaining window between this check and the INSERT below.
    const alreadyMapped = await this.getInvoiceByNumber(invoiceNumber)
    if (alreadyMapped) {
      console.info(
        'InvoiceService#findOrMapInvoiceFromQBO | Mapping already exists, skipping',
      )
      return alreadyMapped
    }

    // 3. Resolve customer mapping (reuse existing pattern from webhookInvoiceCreated)
    const customerService = new CustomerService(this.user)
    const { recipientInfo, companyInfo } =
      await customerService.getRecipientInfo({
        clientId,
        companyId,
      })

    let customerMapId: string
    const existingCustomer =
      await customerService.ensureCustomerExistsAndSyncToken(
        recipientInfo.clientCompanyId,
        recipientInfo.type,
        intuitApi,
      )

    if (existingCustomer) {
      customerMapId = existingCustomer.id
    } else {
      const customerResult = await customerService.findOrCreateCustomer({
        intuitApiService: intuitApi,
        recipientInfo,
        companyInfo,
        invoiceResource: {
          clientId,
          companyId,
        } as InvoiceCreatedResponseType['data'],
      })
      customerMapId = customerResult.customerSyncId
    }

    // 4. Create the qb_invoice_sync mapping row
    const inserted = await this.createQBInvoice(
      {
        portalId: this.user.workspaceId,
        invoiceNumber,
        qbInvoiceId: qbInvoice.Id,
        qbSyncToken: qbInvoice.SyncToken,
        recipientId: recipientInfo.recipientId,
        customerId: customerMapId,
        status,
      },
      ['id'],
    )

    // If onConflictDoNothing skipped the insert, a concurrent delivery won
    // the race. Skip re-logging (the winner already wrote the sync log) and
    // return the existing mapping.
    if (!inserted) {
      return await this.getInvoiceByNumber(invoiceNumber)
    }

    // 5. Create the sync log entry
    await this.logSync(
      copilotInvoiceId,
      {
        qbInvoiceId: qbInvoice.Id,
        invoiceNumber,
      },
      EventType.CREATED,
      {
        amount: total ? total.toFixed(2) : undefined,
        taxAmount: taxAmount ? taxAmount.toFixed(2) : '0',
        customerName: recipientInfo.displayName,
        customerEmail: recipientInfo.email,
      },
    )

    console.info(
      'InvoiceService#findOrMapInvoiceFromQBO | Created mapping for existing QBO invoice',
    )

    return await this.getInvoiceByNumber(invoiceNumber)
  }
}
