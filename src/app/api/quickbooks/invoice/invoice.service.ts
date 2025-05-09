import User from '@/app/api/core/models/User.model'
import { BaseService } from '@/app/api/core/services/base.service'
import { getLatestActiveClient } from '@/app/api/quickbooks/invoice/invoice.helper'
import { buildReturningFields } from '@/db/helper/drizzle.helper'
import {
  QBInvoiceSync,
  QBInvoiceCreateSchema,
  QBInvoiceCreateSchemaType,
} from '@/db/schema/qbInvoiceSync'
import {
  InvoiceCreatedResponseType,
  InvoiceLineItemSchemaType,
} from '@/type/dto/webhook.dto'
import { CopilotAPI } from '@/utils/copilotAPI'
import IntuitAPI, { IntuitAPITokensType } from '@/utils/intuitAPI'
import { and, isNull } from 'drizzle-orm'

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
        throw new Error('Could not find client or company')
      }

      const clients = await this.copilot.getClients({
        companyId: company.id,
      })

      if (!clients?.data || clients.data.length === 0) {
        throw new Error('No clients found')
      }
      client = getLatestActiveClient(clients.data)
    }

    // 2. search client in qb using client's given name and family name
    const intuitApi = new IntuitAPI(qbTokenInfo)
    const customerQuery = `SELECT id FROM Customer WHERE GivenName = '${client.givenName}' AND FamilyName = '${client.familyName}' AND Active = true`
    const qbCustomers = await intuitApi.customQuery(customerQuery)
    let customer = qbCustomers?.QueryResponse?.Customer?.[0]

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
        throw new Error('Failed to create customer')
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
              name: 'Services', // TODO: hardcoding Services. Need to change this when we map the product
              value: '1',
            },
            Qty: lineItem.quantity,
            UnitPrice: actualAmount,
          },
          Description: lineItem.description,
        }
      },
    )

    const qbInvoicePayload = {
      Line: lineItems,
      CustomerRef: {
        value: customer.Id,
      },
    }

    // 5. create invoice in QB
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
