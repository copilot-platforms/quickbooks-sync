import APIError from '@/app/api/core/exceptions/api'
import User from '@/app/api/core/models/User.model'
import { BaseService } from '@/app/api/core/services/base.service'
import { InvoiceStatus, SyncableEntity } from '@/app/api/core/types/invoice'
import { EntityType, EventType, LogStatus } from '@/app/api/core/types/log'
import { CustomerService } from '@/app/api/quickbooks/customer/customer.service'
import { PaymentService } from '@/app/api/quickbooks/payment/payment.service'
import { ProductService } from '@/app/api/quickbooks/product/product.service'
import { SettingService } from '@/app/api/quickbooks/setting/setting.service'
import { SyncLogService } from '@/app/api/quickbooks/syncLog/syncLog.service'
import { buildReturningFields } from '@/db/helper/drizzle.helper'
import { QBCustomers } from '@/db/schema/qbCustomers'
import {
  QBInvoiceCreateSchema,
  QBInvoiceCreateSchemaType,
  QBInvoiceSync,
  QBInvoiceUpdateSchema,
  QBInvoiceUpdateSchemaType,
} from '@/db/schema/qbInvoiceSync'
import { QBProductSync } from '@/db/schema/qbProductSync'
import { TransactionType, WhereClause } from '@/type/common'
import {
  QBCustomerSparseUpdatePayloadType,
  QBCustomerCreatePayloadType,
  QBDestructiveInvoicePayloadSchema,
  QBNameValueSchemaType,
} from '@/type/dto/intuitAPI.dto'
import {
  InvoiceCreatedResponseType,
  InvoiceDeletedResponse,
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

const oneOffItem = {
  name: 'Services', // for one-off items
  value: '1',
}

type InvoiceItemRefAndDescriptionType = {
  ref: QBNameValueSchemaType
  amount?: number
  productDescription?: string
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
    const query = this.db.insert(QBInvoiceSync).values(parsedInsertPayload)

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
      ...(columns && { columns }),
    })
  }

  /**
   * Returns the invoice item reference (QB) for the given product and price
   */
  async getInvoiceItemRef(
    productId: string,
    priceId: string,
    intuitApi: IntuitAPI,
  ): Promise<InvoiceItemRefAndDescriptionType> {
    const productService = new ProductService(this.user)
    const mapping = await productService.getMappingByProductPriceId(
      productId,
      priceId,
    )
    if (mapping) {
      if (mapping.isExcluded) {
        // if excluded, do not include in invoice and send as one-off item
        console.info('InvoiceService#getInvoiceItemRef | Product is excluded')
        return { ref: oneOffItem }
      }
      if (mapping.qbItemId) {
        console.info('InvoiceService#getInvoiceItemRef | Product map found')
        return {
          ref: { value: mapping.qbItemId },
          amount: mapping.unitPrice
            ? parseFloat(mapping.unitPrice) / 100
            : undefined,
          productDescription: mapping.description || '',
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
        'WebhookService#getInvoiceItemRef | Create new product flag is false',
      )
      return { ref: oneOffItem }
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

    // total products with the same product id
    const itemsCount = await productService.getProductCount(
      eq(QBProductSync.productId, productId),
    )

    const newName =
      itemsCount > 0 ? `${productInfo.name} (${itemsCount})` : productInfo.name

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
      unitPrice: Number(priceInfo.amount).toFixed(2), // decimal datatype expects string
    }
    await productService.createQBProduct(productMappingPayload)
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
    }
    await this.syncLogService.createQBSyncLog(syncLogPayload)

    return { ref: { value: qbItem.Id }, productDescription }
  }

  async prepareLineItemPayload(
    lineItem: InvoiceLineItemSchemaType,
    intuitApi: IntuitAPI,
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
      },
      Description:
        typeof itemRef.productDescription === 'undefined'
          ? lineItem.description
          : itemRef.productDescription, // specific check for undefined type. Allow empty string
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

    const customerService = new CustomerService(this.user)
    // 1. get client (retrieve receipentId from invoice resource). Copilot: Retrieve client. If not found, retrieve company and get first client from the company
    const { recipientInfo, companyInfo } =
      await customerService.getRecipientInfo(invoiceResource.recipientId)

    // 2. search client in our mapping table
    const existingCustomer = await customerService.getByCustomerId(
      recipientInfo.id,
      [
        'id',
        'qbCustomerId',
        'qbSyncToken',
        'familyName',
        'givenName',
        'email',
        'companyName',
      ],
    )

    const intuitApi = new IntuitAPI(qbTokenInfo)
    let customer
    if (!existingCustomer) {
      // 2.1. search client in qb using client's given name and family name
      customer = await intuitApi.getACustomer(recipientInfo.displayName)

      let company
      // 3. if not found, create a new client in the QB
      if (!customer) {
        if (!companyInfo || !companyInfo.name) {
          // Case when client is retrieved directly from recipientId
          company = await this.copilot.getCompany(recipientInfo.companyId)

          if (!company || !company.name) {
            // Indicates company is not available in any case. This only logs as error and allows to create customer in QB since company name is optional
            console.error(
              'InvoiceService#handleInvoiceCreated | Could not retrieve company for client = ',
              recipientInfo.id,
            )
          }
        }

        // Create a new customer in QB
        let customerPayload: QBCustomerCreatePayloadType = {
          DisplayName: recipientInfo.displayName,
          CompanyName: company?.name || companyInfo?.name,
          PrimaryEmailAddr: {
            Address: recipientInfo?.email || '',
          },
        }

        if (recipientInfo.givenName && recipientInfo.familyName) {
          customerPayload = {
            ...customerPayload,
            GivenName: recipientInfo.givenName,
            FamilyName: recipientInfo.familyName,
          }
        }

        const customerRes = await intuitApi.createCustomer(customerPayload)
        customer = customerRes.Customer
      }
      // create map for customer into mapping table
      const customerSyncPayload = {
        portalId: this.user.workspaceId,
        customerId: recipientInfo.id,
        givenName: recipientInfo.givenName,
        familyName: recipientInfo.familyName,
        email: recipientInfo.email,
        companyName: company?.name || companyInfo?.name,
        qbSyncToken: customer.SyncToken,
        qbCustomerId: customer.Id,
      }

      await customerService.createQBCustomer(customerSyncPayload)
    } else {
      // update the customer in qb
      const sparseUpdatePayload: Omit<
        QBCustomerSparseUpdatePayloadType,
        'Id' | 'SyncToken' | 'sparse'
      > = {}

      if (existingCustomer.familyName !== recipientInfo.familyName) {
        sparseUpdatePayload.FamilyName = recipientInfo.familyName
      }
      if (existingCustomer.givenName !== recipientInfo.givenName) {
        sparseUpdatePayload.GivenName = recipientInfo.givenName
      }
      if (existingCustomer.email !== recipientInfo.email) {
        sparseUpdatePayload.PrimaryEmailAddr = {
          Address: recipientInfo.email,
        }
      }
      if (Object.keys(sparseUpdatePayload).length > 0) {
        const customerSparsePayload = {
          ...sparseUpdatePayload,
          Id: existingCustomer.qbCustomerId,
          SyncToken: existingCustomer.qbSyncToken,
          DisplayName: recipientInfo.displayName,
          BillAddr: {
            Line1: `${existingCustomer.givenName} ${existingCustomer.familyName}`,
            Line2: existingCustomer.companyName,
          },
          sparse: true as const,
        }

        const customerRes = await intuitApi.customerSparseUpdate(
          customerSparsePayload,
        )
        customer = customerRes.Customer

        // update the customer map in our table
        const customerSyncUpPayload = {
          givenName: recipientInfo.givenName,
          familyName: recipientInfo.familyName,
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

    // bottleneck implementation (rate limiting)
    const lineItemPromises = []
    for (const lineItem of invoiceResource.lineItems) {
      lineItemPromises.push(
        bottleneck.schedule(() => {
          return this.prepareLineItemPayload(lineItem, intuitApi)
        }),
      )
    }

    const lineItems = await Promise.all(lineItemPromises)
    const actualTotalAmount = lineItems.reduce((acc, item) => {
      // calculate the actual tax amount from the lineItems. Not using invoiceResource amount directly as the amount for mapped items can be different (mapped QB amount).
      return acc + item.Amount
    }, 0)
    const totalTax = parseFloat(
      ((actualTotalAmount * invoiceResource.taxPercentage) / 100).toFixed(2),
    )

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
    const invoiceRes = await intuitApi.createInvoice(qbInvoicePayload)

    const invoicePayload = {
      portalId: this.user.workspaceId,
      invoiceNumber: invoiceResource.number,
      qbInvoiceId: invoiceRes.Invoice.Id,
      qbSyncToken: invoiceRes.Invoice.SyncToken,
      recipientId: recipientInfo.id,
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
        intuitApi,
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
    // 1. check if the status of invoice is already paid in sync table
    const invoiceSync = await this.getInvoiceByNumber(payload.data.number, [
      'id',
      'qbInvoiceId',
      'status',
      'recipientId',
    ])

    if (!invoiceSync) {
      throw new APIError(
        httpStatus.NOT_FOUND,
        'WebhookService#webhookInvoicePaid | Invoice not found in sync table',
      )
    }

    // check if the entity invoice has successful event paid
    const syncLog = await this.syncLogService.getOneByCopilotIdAndEventType(
      payload.data.id,
      EventType.PAID,
    )

    if (syncLog?.status === LogStatus.SUCCESS) {
      console.info('WebhookService#webhookInvoicePaid | Invoice already paid')
      return
    }

    // 2. if not, create payment in QB, sync payment in payment sync table and change invoice status to paid
    if (!invoiceSync.recipientId) {
      throw new APIError(
        httpStatus.INTERNAL_SERVER_ERROR,
        'WebhookService#webhookInvoicePaid | RecipientId not found',
      )
    }
    const customerService = new CustomerService(this.user)
    const existingCustomer = await customerService.getByCustomerId(
      invoiceSync.recipientId,
      ['id', 'qbCustomerId', 'givenName', 'familyName', 'email', 'companyName'],
    )
    if (!existingCustomer) {
      throw new APIError(
        httpStatus.INTERNAL_SERVER_ERROR,
        'WebhookService#webhookInvoicePaid | Customer mapping not found',
      )
    }

    // get invoice sync log
    const invoiceLog = await this.syncLogService.getOneByCopilotIdAndEventType(
      payload.data.id,
      EventType.CREATED,
    )

    if (!invoiceLog) {
      throw new APIError(
        httpStatus.INTERNAL_SERVER_ERROR,
        'WebhookService#webhookInvoicePaid | Invoice sync log not found',
      )
    }

    const invoiceAmount = Number(z.string().parse(invoiceLog.amount)) / 100
    const qbPaymentPayload = {
      TotalAmt: invoiceAmount,
      CustomerRef: {
        value: existingCustomer.qbCustomerId,
      },
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
    const intuitApi = new IntuitAPI(qbTokenInfo)
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
        taxAmount: z.string().parse(invoiceLog.taxAmount),
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
    payload: InvoiceResponseType,
    qbTokenInfo: IntuitAPITokensType,
  ): Promise<void> {
    // 1. check if the status of invoice is already paid in sync table
    const invoiceSync = await this.getInvoiceByNumber(payload.data.number, [
      'id',
      'qbInvoiceId',
      'status',
      'qbSyncToken',
      'invoiceNumber',
    ])

    if (!invoiceSync) {
      throw new APIError(
        httpStatus.NOT_FOUND,
        'WebhookService#webhookInvoiceVoided | Invoice not found in sync table',
      )
    }

    if (invoiceSync.status !== InvoiceStatus.OPEN) {
      console.error(
        'WebhookService#handleInvoiceVoided | Invoices void was requested for non-open record',
      )
      return // return early if invoice is not open
    }

    // get invoice sync log
    const invoiceLog = await this.syncLogService.getOneByCopilotIdAndEventType(
      payload.data.id,
      EventType.CREATED,
    )

    if (!invoiceLog) {
      throw new APIError(
        httpStatus.INTERNAL_SERVER_ERROR,
        'WebhookService#webhookInvoicePaid | Invoice sync log not found',
      )
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
      throw new APIError(
        httpStatus.INTERNAL_SERVER_ERROR,
        'WebhookService#webhookInvoiceVoided | Could not parse invoice void payload',
      )
    }

    await intuitApi.voidInvoice(safeParsedPayload.data)
    const customerService = new CustomerService(this.user)
    const { recipientInfo } = await customerService.getRecipientInfo(
      payload.data.recipientId,
    )

    await Promise.all([
      this.updateQBInvoice(
        {
          status: InvoiceStatus.VOID,
        },
        eq(QBInvoiceSync.id, invoiceSync.id),
        ['id'],
      ),
      this.logSync(payload.data.id, invoiceSync, EventType.VOIDED, {
        amount: z.string().parse(invoiceLog.amount),
        taxAmount: z.string().parse(invoiceLog.taxAmount),
        customerName: recipientInfo.displayName,
        customerEmail: recipientInfo.email,
      }),
    ])
  }

  async handleInvoiceDeleted(
    payload: InvoiceDeletedResponse,
    qbTokenInfo: IntuitAPITokensType,
  ): Promise<void> {
    const syncedInvoice = await this.getInvoiceByNumber(payload.number, [
      'id',
      'qbInvoiceId',
      'status',
      'qbSyncToken',
      'invoiceNumber',
    ])

    if (!syncedInvoice) {
      throw new APIError(
        // NOTE: @sandeepbajracharya this can cause an issue where there are invoices that exist before QB sync app has been installed and set up
        // We will not be able to sync new invoice updates for them
        httpStatus.INTERNAL_SERVER_ERROR,
        'WebhookService#handleInvoiceDeleted | Invoice not found in sync table',
      )
    }
    // Copilot doesn't allow to delete invoice that are not voided. So, just log an error about possible edge cases without returning an error
    if (syncedInvoice.status !== InvoiceStatus.VOID) {
      console.error(
        'WebhookService#handleInvoiceDeleted | Invoices delete was requested for non-voided record',
      )
      return // return early if invoice is not voided
    }

    // get invoice sync log
    const invoiceLog = await this.syncLogService.getOneByCopilotIdAndEventType(
      payload.id,
      EventType.CREATED,
    )

    if (!invoiceLog) {
      throw new APIError(
        httpStatus.INTERNAL_SERVER_ERROR,
        'WebhookService#webhookInvoicePaid | Invoice sync log not found',
      )
    }

    const intuitApi = new IntuitAPI(qbTokenInfo)
    const deletePayload = {
      Id: syncedInvoice.qbInvoiceId,
      SyncToken: syncedInvoice.qbSyncToken,
    }
    const safeParsedPayload =
      QBDestructiveInvoicePayloadSchema.safeParse(deletePayload)
    if (!safeParsedPayload.success) {
      throw new APIError(
        httpStatus.INTERNAL_SERVER_ERROR,
        'WebhookService#handleInvoiceDeleted | Could not parse invoice delete payload',
      )
    }

    const customerService = new CustomerService(this.user)
    const { recipientInfo } = await customerService.getRecipientInfo(
      payload.recipientId,
    )

    await intuitApi.deleteInvoice(safeParsedPayload.data)

    await Promise.all([
      this.updateQBInvoice(
        { status: InvoiceStatus.DELETED },
        eq(QBInvoiceSync.id, syncedInvoice.id),
        ['id'],
      ),
      this.logSync(payload.id, syncedInvoice, EventType.DELETED, {
        amount: z.string().parse(invoiceLog.amount),
        taxAmount: z.string().parse(invoiceLog.taxAmount),
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
      ...opts,
    })
  }
}
