import APIError from '@/app/api/core/exceptions/api'
import User from '@/app/api/core/models/User.model'
import { BaseService } from '@/app/api/core/services/base.service'
import { CustomerService } from '@/app/api/quickbooks/customer/customer.service'
import { getLatestActiveClient } from '@/app/api/quickbooks/invoice/invoice.helper'
import { ProductService } from '@/app/api/quickbooks/product/product.service'
import { buildReturningFields } from '@/db/helper/drizzle.helper'
import { QBCustomers } from '@/db/schema/qbCustomers'
import {
  QBInvoiceSync,
  QBInvoiceCreateSchema,
  QBInvoiceCreateSchemaType,
  QBInvoiceUpdateSchemaType,
  QBInvoiceUpdateSchema,
} from '@/db/schema/qbInvoiceSync'
import {
  QBNameValueSchemaType,
  QBCustomerSparseUpdatePayloadType,
  QBVoidInvoicePayloadSchema,
  QBCustomerCreatePayloadType,
} from '@/type/dto/intuitAPI.dto'
import { convert } from 'html-to-text'
import {
  InvoiceCreatedResponseType,
  InvoiceLineItemSchemaType,
  InvoiceResponseType,
} from '@/type/dto/webhook.dto'
import { CopilotAPI } from '@/utils/copilotAPI'
import IntuitAPI, { IntuitAPITokensType } from '@/utils/intuitAPI'
import dayjs from 'dayjs'
import { and, eq, isNull } from 'drizzle-orm'
import httpStatus from 'http-status'
import { bottleneck } from '@/utils/bottleneck'
import { InvoiceStatus } from '@/app/api/core/types/invoice'
import { PaymentService } from '@/app/api/quickbooks/payment/payment.service'
import { TransactionType, WhereClause } from '@/type/common'
import { z } from 'zod'
import { SettingService } from '@/app/api/quickbooks/setting/setting.service'
import { SyncLogService } from '@/app/api/quickbooks/syncLog/syncLog.service'
import { EntityType, EventType, LogStatus } from '@/app/api/core/types/log'

const oneOffItem = {
  name: 'Services', // for one-off items
  value: '1',
}

type InvoiceItemRefAndDescriptionType = {
  ref: QBNameValueSchemaType
  productDescription?: string
}

type ClientCompanyType = {
  id: string
  givenName: string
  familyName: string
  companyId: string
  email: string
  displayName: string
  type: 'client' | 'company'
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
          productDescription: mapping.description || '',
        }
      }
    }

    // check if the flag is on for create new item
    const settingService = new SettingService(this.user)
    const setting = await settingService.getOneByPortalId([
      'createInvoiceItemFlag',
    ])

    if (!setting?.createInvoiceItemFlag) {
      console.info(
        'WebhookService#getInvoiceItemRef | Create new invoice item flag is false',
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
      productId,
      priceId,
      qbItemId: qbItem.Id,
      qbSyncToken: qbItem.SyncToken,
      name: productInfo.name,
      description: productDescription,
      unitPrice: Number(priceInfo.amount).toFixed(2), // decimal datatype expects string
    }
    await productService.createQBProduct(productMappingPayload)

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
    let clientCompany: ClientCompanyType = {
      id: invoiceResource.recipientId,
      givenName: '',
      familyName: '',
      companyId: '',
      email: '',
      displayName: '',
      type: 'client',
    }

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

      // check if the company name flag is turned on.
      const settingService = new SettingService(this.user)
      const setting = await settingService.getOneByPortalId([
        'useCompanyNameFlag',
      ])

      if (setting?.useCompanyNameFlag) {
        // if yes, load data to create/update a customer with company info in Quickbooks
        clientCompany.displayName = company.name
        clientCompany.type = 'company'
        clientCompany.companyId = company.id
      } else {
        // if no, load data to create/update a customer with client info in Quickbooks
        const clients = await this.copilot.getClients({
          companyId: company.id,
        })

        if (!clients?.data || clients.data.length === 0) {
          throw new APIError(httpStatus.NOT_FOUND, 'No clients found')
        }
        client = getLatestActiveClient(clients.data)
        clientCompany = {
          ...clientCompany,
          familyName: client.familyName,
          givenName: client.givenName,
          displayName: client.givenName + ' ' + client.familyName,
          type: 'client',
          email: client.email,
          companyId: company.id,
        }
      }
    } else {
      clientCompany = {
        ...clientCompany,
        familyName: client.familyName,
        givenName: client.givenName,
        displayName: client.givenName + ' ' + client.familyName,
        type: 'client',
        email: client.email,
        companyId: client.companyId,
      }
    }

    // 2. search client in our mapping table
    const customerService = new CustomerService(this.user)
    const existingCustomer = await customerService.getByCustomerId(
      clientCompany.id,
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
      customer = await intuitApi.getACustomer(clientCompany.displayName)

      // 3. if not found, create a new client in the QB
      if (!customer) {
        if (!company) {
          // Case when client is retrieved directly from recipientId
          company = await this.copilot.getCompany(clientCompany.companyId)

          if (!company) {
            // Indicates company is not available in any case. This only logs as error and allows to create customer in QB since company name is optional
            console.error(
              'InvoiceService#handleInvoiceCreated | Could not retrieve company for client = ',
              clientCompany.id,
            )
          }
        }

        // Create a new customer in QB
        let customerPayload: QBCustomerCreatePayloadType = {
          DisplayName: clientCompany.displayName,
          CompanyName: company?.name,
          PrimaryEmailAddr: {
            Address: clientCompany.email,
          },
        }

        if (clientCompany.givenName && clientCompany.familyName) {
          customerPayload = {
            ...customerPayload,
            GivenName: clientCompany.givenName,
            FamilyName: clientCompany.familyName,
          }
        }

        const customerRes = await intuitApi.createCustomer(customerPayload)
        customer = customerRes.Customer
      }
      // create map for customer into mapping table
      const customerSyncPayload = {
        portalId: this.user.workspaceId,
        customerId: clientCompany.id,
        givenName: clientCompany.givenName,
        familyName: clientCompany.familyName,
        email: clientCompany.email,
        companyName: company?.name,
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

      if (existingCustomer.familyName !== clientCompany.familyName) {
        sparseUpdatePayload.FamilyName = clientCompany.familyName
      }
      if (existingCustomer.givenName !== clientCompany.givenName) {
        sparseUpdatePayload.GivenName = clientCompany.givenName
      }
      if (existingCustomer.email !== clientCompany.email) {
        sparseUpdatePayload.PrimaryEmailAddr = {
          Address: clientCompany.email,
        }
      }
      if (Object.keys(sparseUpdatePayload).length > 0) {
        const customerSparsePayload = {
          ...sparseUpdatePayload,
          Id: existingCustomer.qbCustomerId,
          SyncToken: existingCustomer.qbSyncToken,
          DisplayName: clientCompany.displayName,
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
          givenName: clientCompany.givenName,
          familyName: clientCompany.familyName,
          email: clientCompany.email,
          companyName: company?.name,
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
      ...(invoiceResource?.taxAmount && {
        TxnTaxDetail: {
          TotalTax: Number((invoiceResource.taxAmount / 100).toFixed(2)),
        },
      }),
      ...(invoiceResource?.sentDate && {
        TxnDate: dayjs(invoiceResource.sentDate).format('yyyy/MM/dd'), // Valid date format for TxnDate is yyyy/MM/dd. For more info: https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/invoice#the-invoice-object
      }),
      ...(invoiceResource?.dueDate && {
        DueDate: dayjs(invoiceResource.dueDate).format('YYYY-MM-DD'), // the date format for due date follows XML Schema standard (YYYY-MM-DD). For more info: https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/invoice#the-invoice-object
      }),
    }

    // 6. create invoice in QB
    const invoiceRes = await intuitApi.createInvoice(qbInvoicePayload)

    const invoicePayload = {
      portalId: this.user.workspaceId,
      invoiceNumber: invoiceResource.number,
      qbInvoiceId: invoiceRes.Invoice.Id,
      qbSyncToken: invoiceRes.Invoice.SyncToken,
      recipientId: clientCompany.id,
      status: invoiceResource.status,
    }
    await this.createQBInvoice(invoicePayload)

    // update/ create the record in sync log table
    await this.syncLogService.updateOrCreateQBSyncLog({
      portalId: this.user.workspaceId,
      entityType: EntityType.INVOICE,
      eventType: EventType.CREATED,
      status: LogStatus.SUCCESS,
      copilotId: invoiceResource.id,
      quickbooksId: invoiceRes.Invoice.Id,
      syncAt: dayjs().toDate(),
      invoiceNumber: invoiceResource.number,
      amount: invoiceResource.total.toFixed(2),
    })

    /**
     * here, creates a payment if invoice is paid. "invoice.paid" hook can trigger before "invoice.created" hook
     * this can create issue as invoice is not found when "invoice.paid" hook is triggered
     */
    if (invoiceResource.status === InvoiceStatus.PAID) {
      const paymentService = new PaymentService(this.user)
      const totalActualAmount = invoiceResource.total / 100
      const qbPaymentPayload = {
        TotalAmt: totalActualAmount,
        CustomerRef: {
          value: customerRefValue,
        },
        Line: [
          {
            Amount: totalActualAmount,
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
        invoiceResource.number,
        invoiceResource.id,
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
    if (!invoiceSync?.recipientId) {
      throw new APIError(
        httpStatus.INTERNAL_SERVER_ERROR,
        'WebhookService#webhookInvoicePaid | RecipientId not found',
      )
    }
    const customerService = new CustomerService(this.user)
    const existingCustomer = await customerService.getByCustomerId(
      invoiceSync.recipientId,
      ['id', 'qbCustomerId'],
    )
    if (!existingCustomer) {
      throw new APIError(
        httpStatus.INTERNAL_SERVER_ERROR,
        'WebhookService#webhookInvoicePaid | Customer mapping not found',
      )
    }

    const actualAmount = payload.data.total / 100 // Convert to dollar. amount received in cents.
    const qbPaymentPayload = {
      TotalAmt: actualAmount,
      CustomerRef: {
        value: existingCustomer.qbCustomerId,
      },
      Line: [
        {
          Amount: actualAmount,
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

    const success = await paymentService.createPaymentAndSync(
      intuitApi,
      qbPaymentPayload,
      payload.data.number,
      payload.data.id,
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

    const syncLog = await this.syncLogService.getOneByCopilotIdAndEventType(
      payload.data.id,
      EventType.VOIDED,
    )

    if (syncLog?.status === LogStatus.SUCCESS) {
      console.info(
        'WebhookService#webhookInvoiceVoided | Invoice already voided',
      )
    }

    // only implement void if invoice has open status
    const intuitApi = new IntuitAPI(qbTokenInfo)
    const voidPayload = {
      Id: invoiceSync.qbInvoiceId,
      SyncToken: invoiceSync.qbSyncToken,
    }
    const safeParsedPayload = QBVoidInvoicePayloadSchema.safeParse(voidPayload)

    if (!safeParsedPayload.success || !safeParsedPayload.data) {
      throw new APIError(
        httpStatus.INTERNAL_SERVER_ERROR,
        'WebhookService#webhookInvoiceVoided | Could not parse invoice void payload',
      )
    }

    await intuitApi.voidInvoice(safeParsedPayload.data)

    await Promise.all([
      this.updateQBInvoice(
        {
          status: InvoiceStatus.VOID,
        },
        eq(QBInvoiceSync.id, invoiceSync.id),
        ['id'],
      ),
      this.syncLogService.updateOrCreateQBSyncLog({
        portalId: this.user.workspaceId,
        entityType: EntityType.INVOICE,
        eventType: EventType.VOIDED,
        status: LogStatus.SUCCESS,
        copilotId: payload.data.id,
        syncAt: dayjs().toDate(),
        quickbooksId: invoiceSync.qbInvoiceId,
        invoiceNumber: invoiceSync.invoiceNumber,
        amount: payload.data.total.toFixed(2),
      }),
    ])
  }
}
