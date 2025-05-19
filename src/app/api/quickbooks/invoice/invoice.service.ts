import APIError from '@/app/api/core/exceptions/api'
import User from '@/app/api/core/models/User.model'
import { BaseService } from '@/app/api/core/services/base.service'
import { CustomerService } from '@/app/api/quickbooks/customer/customer.service'
import { getLatestActiveClient } from '@/app/api/quickbooks/invoice/invoice.helper'
import { buildReturningFields } from '@/db/helper/drizzle.helper'
import { QBCustomers } from '@/db/schema/qbCustomers'
import {
  QBInvoiceSync,
  QBInvoiceCreateSchema,
  QBInvoiceCreateSchemaType,
} from '@/db/schema/qbInvoiceSync'
import { QBCustomerParseUpdatePayloadType } from '@/type/dto/intuitAPI.dto'
import {
  InvoiceCreatedResponseType,
  InvoiceLineItemSchemaType,
} from '@/type/dto/webhook.dto'
import { CopilotAPI } from '@/utils/copilotAPI'
import IntuitAPI, { IntuitAPITokensType } from '@/utils/intuitAPI'
import dayjs from 'dayjs'
import { and, eq, isNull } from 'drizzle-orm'
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

  async webhookInvoiceCreated(
    payload: InvoiceCreatedResponseType,
    qbTokenInfo: IntuitAPITokensType,
  ) {
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

    // 2. search client in our mapping table
    const customerService = new CustomerService(this.user)
    const existingCustomer = await customerService.getByClientId(client.id, [
      'id',
      'qbCustomerId',
      'qbSyncToken',
      'familyName',
      'givenName',
      'email',
    ])

    let customer
    const intuitApi = new IntuitAPI(qbTokenInfo)

    if (!existingCustomer) {
      // 2.1. search client in qb using client's given name and family name
      const customerQuery = `SELECT id, SyncToken FROM Customer WHERE GivenName = '${client.givenName}' AND FamilyName = '${client.familyName}' AND Active = true`
      const qbCustomers = await intuitApi.customQuery(customerQuery)
      customer = qbCustomers?.QueryResponse?.Customer?.[0]

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
      }
      // create map for customer into mapping table
      const customerSyncPayload = {
        portalId: qbTokenInfo.intuitRealmId,
        clientId: client.id,
        givenName: client.givenName,
        familyName: client.familyName,
        email: client.email,
        companyName: company?.name,
        qbSyncToken: customer.SyncToken,
        qbCustomerId: customer.Id,
      }

      await customerService.createQBCustomer(customerSyncPayload)
    } else {
      // update the customer in qb
      const sparseUpdatePayload: Omit<
        QBCustomerParseUpdatePayloadType,
        'Id' | 'SyncToken'
      > = {}

      if (existingCustomer.familyName !== client.familyName) {
        sparseUpdatePayload.FamilyName = client.familyName
      }
      if (existingCustomer.givenName !== client.givenName) {
        sparseUpdatePayload.GivenName = client.givenName
      }
      if (existingCustomer.email !== client.email) {
        sparseUpdatePayload.PrimaryEmailAddr = {
          Address: client.email,
        }
      }
      if (Object.keys(sparseUpdatePayload).length > 0) {
        const customerSparsePayload = {
          ...sparseUpdatePayload,
          Id: existingCustomer.qbCustomerId,
          SyncToken: existingCustomer.qbSyncToken,
          DisplayName: `${client.givenName} ${client.familyName}`,
          BillAddr: {
            Line1: `${existingCustomer.givenName} ${existingCustomer.familyName}`,
            Line2: existingCustomer.companyName,
          },
          sparse: true,
        } as QBCustomerParseUpdatePayloadType

        const customerRes = await intuitApi.parseUpdateCustomer(
          customerSparsePayload,
        )
        customer = customerRes.Customer

        // update the customer map in our table
        const customerSyncUpPayload = {
          givenName: client.givenName,
          familyName: client.familyName,
          email: client.email,
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

    // 4. prepare payload for invoice with lineItems
    const lineItems = invoiceResource.lineItems.map(
      (lineItem: InvoiceLineItemSchemaType) => {
        const actualAmount = lineItem.amount / 100 // Convert to dollar. amount received in cents.
        return {
          DetailType: 'SalesItemLineDetail',
          Amount: actualAmount * lineItem.quantity,
          SalesItemLineDetail: {
            ItemRef: {
              name: 'Services', // hardcoding Services. Need to change this when we map the product
              value: '1',
            },
            Qty: lineItem.quantity,
            UnitPrice: actualAmount,
            TaxCodeRef: {
              // required to enable tax for the product
              value: 'TAX',
            },
          },
          Description: lineItem.description,
        }
      },
    )

    const qbInvoicePayload = {
      Line: lineItems,
      CustomerRef: {
        value: customer?.Id || existingCustomer?.qbCustomerId,
      },
      // include tax and dates
      ...(invoiceResource?.taxAmount && {
        TxnTaxDetail: {
          TotalTax: Number((invoiceResource.taxAmount / 100).toFixed(2)),
        },
      }),
      ...(invoiceResource?.sentDate && {
        TxnDate: dayjs(invoiceResource.sentDate).format('yyyy/MM/dd'),
      }),
      ...(invoiceResource?.dueDate && {
        DueDate: dayjs(invoiceResource.dueDate).format('YYYY-MM-DD'),
      }),
    }

    // 6. create invoice in QB
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
