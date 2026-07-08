import APIError from '@/app/api/core/exceptions/api'
import User from '@/app/api/core/models/User.model'
import { BaseService } from '@/app/api/core/services/base.service'
import { InvoiceStatus, SyncableEntity } from '@/app/api/core/types/invoice'
import {
  EntityType,
  EventType,
  FailedRecordCategoryType,
  LogStatus,
} from '@/app/api/core/types/log'
import { CustomerService } from '@/app/api/quickbooks/customer/customer.service'
import {
  findNextAvailableDocNumber,
  formatAssemblyInvoicePrivateNote,
  isQBODuplicateDocNumberError,
} from '@/app/api/quickbooks/invoice/invoice.utils'
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
  QBInvoiceResponseType,
} from '@/type/dto/intuitAPI.dto'
import {
  InvoiceCreatedResponseType,
  InvoiceDestructiveResponse,
  InvoiceLineItemSchemaType,
  InvoiceResponseType,
} from '@/type/dto/webhook.dto'
import { bottleneck } from '@/utils/bottleneck'
import { CopilotAPI } from '@/utils/copilotAPI'
import IntuitAPI, { IntuitAPITokensType } from '@/utils/intuitAPI'
import dayjs from 'dayjs'
import { and, eq, isNull } from 'drizzle-orm'
import { convert } from 'html-to-text'
import httpStatus from 'http-status'
import { z } from 'zod'
import { addSyncBreadcrumb, captureSyncError } from '@/utils/sentry'
import { replaceSpecialCharsForQB, truncateForQB } from '@/utils/string'
import { AccountTypeObj } from '@/constant/qbConnection'
import { getUsStateCode } from '@/utils/common'

type OneOffItemType = {
  name?: string
  value: string
}

type InvoiceItemRefAndDescriptionType = {
  ref: QBNameValueSchemaType
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

  /**
   * Returns the invoice item reference (QB) for the given product.
   */
  private async getInvoiceItemRef(
    productId: string,
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

        const intuitItem = await intuitApi.getAnItem(
          undefined,
          mapping.qbItemId,
        )
        if (!intuitItem) return { ref: oneOffItem } // if item is not present in Intuit, return one-off item

        return {
          ref: { value: mapping.qbItemId },
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

    // 2. create a new product in QB company. No price here — invoice lines
    // carry their own UnitPrice, matching product.created behavior.
    const incomeAccRefVal = incomeAccRef

    const newName = truncateForQB(replaceSpecialCharsForQB(productInfo.name))

    // check if item exist with name in QB. If yes, map in mapping table
    let qbItem = await intuitApi.getAnItem(newName)

    if (!qbItem) {
      // create item in QB
      qbItem = await productService.createItemInQB(
        {
          productName: newName,
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
      qbItemId: qbItem.Id,
      qbSyncToken: qbItem.SyncToken,
      copilotName: productInfo.name,
      name: qbItem.Name,
      description: productDescription,
    }
    const conditions = and(
      eq(QBProductSync.portalId, this.user.workspaceId),
      eq(QBProductSync.productId, productId),
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
      qbItemName: qbItem.Name,
      errorMessage: null,
    }

    // insert or update the sync log for product creation
    const syncLogConditions = and(
      eq(QBSyncLog.portalId, this.user.workspaceId),
      eq(QBSyncLog.copilotId, productId),
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
        intuitApi,
        oneOffItem,
        incomeAccRef,
      )
    }
    return {
      DetailType: 'SalesItemLineDetail',
      Amount: actualAmount * lineItem.quantity,
      SalesItemLineDetail: {
        ItemRef: itemRef.ref,
        Qty: lineItem.quantity,
        UnitPrice: actualAmount,
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

  // Batched-deposit mode routes the payment through Undeposited Funds so the
  // payout deposit can later link and sweep it into the bank. Returns
  // undefined when batching is off, letting QBO use its default account.
  private async resolveDepositToAccountRef(
    intuitApi: IntuitAPI,
  ): Promise<string | undefined> {
    const settingService = new SettingService(this.user)
    const setting = await settingService.getOneByPortalId([
      'bankDepositFeeFlag',
    ])
    return setting?.bankDepositFeeFlag
      ? await intuitApi.getUndepositedFundsAccountId()
      : undefined
  }

  /**
   * Pre-flights QBO for invoices whose DocNumber starts with the Assembly
   * invoice number and returns the lowest free slot (`<n>`, `<n>-1`, …).
   * Used by webhookInvoiceCreated to dodge 6140 collisions when a customer
   * has already created an invoice with the same DocNumber in QBO manually.
   */
  private async resolveAvailableDocNumber(
    intuitApi: IntuitAPI,
    assemblyInvoiceNumber: string,
  ): Promise<string> {
    const existing = await intuitApi.findInvoicesByDocNumberPrefix(
      assemblyInvoiceNumber,
    )
    const taken = new Set(existing.map((inv) => inv.DocNumber))
    try {
      return findNextAvailableDocNumber(assemblyInvoiceNumber, taken)
    } catch (err) {
      // Exhaustion / length-limit throws aren't recoverable by resync —
      // surface to Sentry so engineering sees them. Re-throw so the
      // existing FAILED sync_log path still records the row.
      captureSyncError(
        err,
        { area: 'docnumber-walk-unresolvable' },
        {
          portalId: this.user.workspaceId,
          assemblyInvoiceNumber,
          takenCount: taken.size,
        },
      )
      throw err
    }
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
      // Sum the per-line amounts (each line's UnitPrice comes from the invoice
      // line itself) rather than trusting invoiceResource's total.
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

    // Resolve a DocNumber that won't collide in QBO. Pre-flight a prefix
    // query, pick the lowest free slot (`<n>`, `<n>-1`, `<n>-2`, …). On 6140
    // race (customer manually created the slot we picked between our query
    // and our create), re-walk once and retry. After that, throw and let
    // resync handle it.
    const assemblyInvoiceNumber = invoiceResource.number
    let docNumber = await this.resolveAvailableDocNumber(
      intuitApiService,
      assemblyInvoiceNumber,
    )

    // To add customer bill email in Invoice. Docs:
    // https://help.developer.intuit.com/s/question/0D50f00005E4I5nCAF/customer-email-not-showing-on-invoice
    const billEmailAddress =
      customer?.PrimaryEmailAddr?.Address || existingCustomer?.email

    const countrySubDivisionCode = getUsStateCode(
      invoiceResource.address?.region,
    )

    // QBO needs both state and postal code to resolve a tax jurisdiction.
    const addressPayload =
      invoiceResource.address?.postalCode && countrySubDivisionCode
        ? {
            Line1:
              invoiceResource.address.addressLine1 ||
              invoiceResource.address.addressLine2,
            City: invoiceResource.address.city,
            CountrySubDivisionCode: countrySubDivisionCode,
            PostalCode: invoiceResource.address.postalCode,
            Country: invoiceResource.address.country,
          }
        : null

    const buildPayload = (resolvedDocNumber: string) => ({
      Line: lineItems,
      CustomerRef: {
        value: customerRefValue,
      },
      DocNumber: resolvedDocNumber,
      PrivateNote: formatAssemblyInvoicePrivateNote(assemblyInvoiceNumber),
      // include tax and dates
      TxnTaxDetail: {
        TotalTax: totalTax, // Always override tax total. Address tax jurisdiction is only for report purpose. We dont actually calculate tax with address.
      },
      ...(invoiceResource?.sentDate && {
        TxnDate: dayjs(invoiceResource.sentDate).format('YYYY/MM/DD'), // Valid date format for TxnDate is YYYY/MM/DD. For more info: https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/invoice#the-invoice-object
      }),
      ...(invoiceResource?.dueDate && {
        DueDate: dayjs(invoiceResource.dueDate).format('YYYY-MM-DD'), // the date format for due date follows XML Schema standard (YYYY-MM-DD). For more info: https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/invoice#the-invoice-object
      }),
      BillEmail: {
        Address: billEmailAddress,
      },
      ...(addressPayload && {
        BillAddr: addressPayload,
        ShipAddr: addressPayload,
      }),
    })

    // 6. create invoice in QB
    addSyncBreadcrumb('Creating invoice in QBO', {
      invoiceNumber: assemblyInvoiceNumber,
      docNumber,
    })

    let invoiceRes: QBInvoiceResponseType
    try {
      invoiceRes = await intuitApiService.createInvoice(buildPayload(docNumber))
    } catch (err) {
      if (!isQBODuplicateDocNumberError(err)) throw err
      console.info(
        `InvoiceService#webhookInvoiceCreated | 6140 on DocNumber=${docNumber}; re-walking once`,
      )
      docNumber = await this.resolveAvailableDocNumber(
        intuitApiService,
        assemblyInvoiceNumber,
      )
      addSyncBreadcrumb('Retrying invoice creation in QBO after 6140', {
        invoiceNumber: assemblyInvoiceNumber,
        docNumber,
      })
      invoiceRes = await intuitApiService.createInvoice(buildPayload(docNumber))
    }

    const invoicePayload = {
      portalId: this.user.workspaceId,
      invoiceNumber: invoiceResource.number,
      qbInvoiceId: invoiceRes.Invoice.Id,
      qbDocNumber: docNumber,
      qbSyncToken: invoiceRes.Invoice.SyncToken,
      recipientId: recipientInfo.recipientId,
      customerId: existingCustomerMapId, // foreign key to customer mapping
      status: invoiceResource.status,
    }
    const inserted = await this.createQBInvoice(invoicePayload, ['id'])

    // If onConflictDoNothing skipped the insert, a concurrent delivery won
    // the race. Skip logSync (the winner already wrote the CREATED log;
    // overwriting it would point quickbooks_id at this losing webhook's
    // orphaned QBO invoice) and skip the paid-path payment creation.
    // Note: the duplicate QBO invoice from createInvoice above is the
    // dual-create issue tracked separately in OUT-3655.
    if (!inserted) {
      console.info(
        'InvoiceService#webhookInvoiceCreated | Mapping already exists (race loss), skipping logSync and payment',
      )
      return
    }

    // update/ create the record in sync log table
    const totalWithTax =
      invoiceRes.Invoice.TotalAmt ?? actualTotalAmount + totalTax
    const taxForLog = invoiceRes.Invoice.TxnTaxDetail?.TotalTax ?? totalTax
    await this.logSync(
      invoiceResource.id,
      {
        qbInvoiceId: invoiceRes.Invoice.Id,
        invoiceNumber: invoiceResource.number,
      },
      EventType.CREATED,
      {
        amount: (totalWithTax * 100).toFixed(2),
        taxAmount: (taxForLog * 100).toFixed(2), // convert to cents for logs
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
      // Same batched-deposit routing as invoice.paid: a paid-on-create
      // payment must land in Undeposited Funds so the payout deposit can
      // sweep it, otherwise it deposits straight to the bank and the batched
      // deposit can't link it.
      const depositToAccountRef =
        await this.resolveDepositToAccountRef(intuitApiService)
      const qbPaymentPayload = {
        TotalAmt: totalWithTax,
        CustomerRef: {
          value: customerRefValue,
        },
        ...(depositToAccountRef && {
          DepositToAccountRef: { value: depositToAccountRef },
        }),
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
          taxAmount: (taxForLog * 100).toFixed(2),
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
    const invoiceSync = await this.getInvoiceByNumber(payload.data.number, [
      'id',
      'qbInvoiceId',
      'status',
      'customerId',
    ])

    if (!invoiceSync) {
      // Throw so the webhook-level catch writes a FAILED PAID log; the
      // resync cron will retry once a CREATED resync establishes the mapping.
      throw new APIError(
        httpStatus.NOT_FOUND,
        `Invoice not found in sync table for paid event. Invoice number: ${payload.data.number}. Likely preceded by a failed CREATE sync.`,
      )
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

    const invoiceLog = await this.getCreatedInvoiceLogOrThrow(
      payload.data.id,
      'InvoiceService#webhookInvoicePaid',
    )

    const invoiceAmount = Number(z.string().parse(invoiceLog.amount)) / 100

    const intuitApi = new IntuitAPI(qbTokenInfo)
    const depositToAccountRef = await this.resolveDepositToAccountRef(intuitApi)

    const qbPaymentPayload = {
      TotalAmt: invoiceAmount,
      CustomerRef: {
        value: existingCustomer.qbCustomerId,
      },
      ...(depositToAccountRef && {
        DepositToAccountRef: { value: depositToAccountRef },
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
    payload: InvoiceDestructiveResponse,
    qbTokenInfo: IntuitAPITokensType,
  ): Promise<void> {
    addSyncBreadcrumb('Invoice voided flow started', {
      invoiceNumber: payload.number,
    })
    // 1. check if the status of invoice is already paid in sync table
    const invoiceSync = await this.getInvoiceByNumber(payload.number, [
      'id',
      'qbInvoiceId',
      'status',
      'qbSyncToken',
      'invoiceNumber',
    ])

    if (!invoiceSync) {
      // Throw so the webhook-level catch writes a FAILED VOIDED log; the
      // resync cron will retry once a CREATED resync establishes the mapping.
      throw new APIError(
        httpStatus.NOT_FOUND,
        `Invoice not found in sync table for void event. Invoice number: ${payload.number}. Likely preceded by a failed CREATE sync.`,
      )
    }

    if (invoiceSync.status !== InvoiceStatus.OPEN) {
      // Non-OPEN is terminal — finalize the log so the claim isn't left PENDING
      // to be reaped into a retryable, message-less FAILED row (OUT-3867).
      if (invoiceSync.status === InvoiceStatus.VOID) {
        // Already void in QBO — idempotent success, no re-void.
        await this.logSync(payload.id, invoiceSync, EventType.VOIDED)
        return
      }
      // Never voidable — non-retryable failure, not a 25-retry loop. No
      // errorCode so the IU notifier stays a no-op.
      console.error(
        'InvoiceService#webhookInvoiceVoided | Void requested on non-open invoice',
      )
      await this.syncLogService.updateOrCreateQBSyncLog({
        portalId: this.user.workspaceId,
        entityType: EntityType.INVOICE,
        eventType: EventType.VOIDED,
        status: LogStatus.FAILED,
        copilotId: payload.id,
        invoiceNumber: payload.number,
        errorMessage: `Void requested on non-open invoice (status=${invoiceSync.status}). Invoice number: ${payload.number}`,
        shouldRetry: false,
        category: FailedRecordCategoryType.VALIDATION,
      })
      return
    }

    const invoiceLog = await this.getCreatedInvoiceLogOrThrow(
      payload.id,
      'InvoiceService#webhookInvoiceVoided',
    )

    // only implement void if invoice has open status
    const intuitApi = new IntuitAPI(qbTokenInfo)
    const voidPayload = this.buildDestructivePayloadOrThrow(
      invoiceSync,
      payload.number,
      'InvoiceService#webhookInvoiceVoided',
    )

    await intuitApi.voidInvoice(voidPayload)
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
    payload: InvoiceDestructiveResponse,
    qbTokenInfo: IntuitAPITokensType,
  ): Promise<void> {
    addSyncBreadcrumb('Invoice deleted flow started', {
      invoiceNumber: payload.number,
    })

    const syncedInvoice = await this.getInvoiceByNumber(payload.number, [
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

    // QBO has the invoice but we have no local mapping. Throw so the
    // webhook-level catch writes a FAILED DELETED log; the resync cron will
    // retry once a CREATED resync establishes the mapping.
    if (!syncedInvoice) {
      throw new APIError(
        httpStatus.NOT_FOUND,
        `Invoice not found in sync table for delete event. Invoice number: ${payload.number}. Likely preceded by a failed CREATE sync.`,
      )
    }

    // Copilot only fires delete on voided invoices; surface any other state
    // as a FAILED log via the webhook catch.
    if (syncedInvoice.status !== InvoiceStatus.VOID) {
      console.error(
        'InvoiceService#handleInvoiceDeleted | Invoices delete was requested for non-voided record',
      )
      throw new Error('Invoices delete was requested for non-voided record')
    }

    const invoiceLog = await this.getCreatedInvoiceLogOrThrow(
      payload.id,
      'InvoiceService#handleInvoiceDeleted',
    )

    const deletePayload = this.buildDestructivePayloadOrThrow(
      syncedInvoice,
      payload.number,
      'InvoiceService#handleInvoiceDeleted',
    )

    const customerService = new CustomerService(this.user)
    const { recipientInfo } = await customerService.getRecipientInfo({
      clientId: payload.clientId,
      companyId: payload.companyId,
    })

    await intuitApi.deleteInvoice(deletePayload)

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

  // Gets the CREATED sync log. Paid/voided/deleted all need it settled.
  // Separate messages so the FAILED log shows which case it hit. `caller`
  // names the originating handler in server logs.
  private async getCreatedInvoiceLogOrThrow(copilotId: string, caller: string) {
    const invoiceLog = await this.syncLogService.getOneByCopilotIdAndEventType({
      copilotId,
      eventType: EventType.CREATED,
      entityType: EntityType.INVOICE,
    })
    if (!invoiceLog) {
      console.error(`${caller} | Invoice sync log not found`)
      throw Error('Invoice sync log not found')
    }
    if (invoiceLog.status === LogStatus.PENDING) {
      console.error(`${caller} | Invoice sync log still pending`)
      throw Error('Invoice sync log still pending')
    }
    return invoiceLog
  }

  // Builds the { Id, SyncToken } payload QBO needs to void or delete an
  // invoice. Throws if the synced invoice has no id/token. `caller` names
  // the originating handler in server logs.
  private buildDestructivePayloadOrThrow(
    syncedInvoice: { qbInvoiceId: string | null; qbSyncToken: string | null },
    invoiceNumber: string,
    caller: string,
  ): QBDestructiveInvoicePayloadSchema {
    const parsedPayload = QBDestructiveInvoicePayloadSchema.safeParse({
      Id: syncedInvoice.qbInvoiceId,
      SyncToken: syncedInvoice.qbSyncToken,
    })
    if (!parsedPayload.success) {
      console.error(`${caller} | Could not parse invoice destructive payload`)
      throw new APIError(
        httpStatus.INTERNAL_SERVER_ERROR,
        `Could not parse invoice destructive payload. Invoice number: ${invoiceNumber}`,
      )
    }
    return parsedPayload.data
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

  /**
   * Looks up an invoice in QBO by DocNumber and, if present, lazily writes
   * the local `qb_invoice_sync` mapping plus a CREATED sync log so downstream
   * code can treat the invoice as already synced.
   *
   * Deliberately NOT called from the invoice created/paid/voided/deleted
   * webhook handlers. An operator can create an unrelated invoice directly
   * in QBO that happens to share a DocNumber with a Copilot invoice; if this
   * helper ran on the webhook path it would bind the Copilot invoice to that
   * unrelated QBO record, producing an inaccurate mapping that corrupts
   * every subsequent paid/voided/deleted event for the same number. The
   * webhook handlers therefore throw on missing mapping and let the resync
   * cron retry once a CREATED resync establishes the correct mapping.
   *
   * Sole caller is `checkIfInvoiceExistsInQBO`, used by the
   * `syncMissedInvoices` cron — a deliberate batch reconciliation where
   * mapping-on-find is the explicit goal.
   */
  async findOrMapInvoiceFromQBO(params: {
    invoiceNumber: string
    copilotInvoiceId: string
    clientId: string
    companyId: string
    status: InvoiceStatus
    total?: number
    taxAmount?: number | null
    intuitApi: IntuitAPI
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

    // 1. Query QBO for the invoice by DocNumber
    const qbInvoice = await intuitApi.getInvoice(invoiceNumber)
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
        qbDocNumber: invoiceNumber,
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
