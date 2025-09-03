import APIError from '@/app/api/core/exceptions/api'
import { BaseService } from '@/app/api/core/services/base.service'
import { getLatestActiveClient } from '@/app/api/quickbooks/invoice/invoice.helper'
import { SettingService } from '@/app/api/quickbooks/setting/setting.service'
import { buildReturningFields } from '@/db/helper/drizzle.helper'
import {
  QBCustomerCreateSchema,
  QBCustomerCreateSchemaType,
  QBCustomers,
  QBCustomerUpdateSchema,
  QBCustomerUpdateSchemaType,
} from '@/db/schema/qbCustomers'
import { CompanyResponse, WhereClause } from '@/type/common'
import { CopilotAPI } from '@/utils/copilotAPI'
import { and, isNull } from 'drizzle-orm'
import httpStatus from 'http-status'

type ClientCompanyType = {
  clientCompanyId: string
  recipientId: string
  givenName: string
  familyName: string
  companyId: string
  email: string
  displayName: string
  type: 'client' | 'company'
  companyName: string
}

export class CustomerService extends BaseService {
  async createQBCustomer(
    payload: QBCustomerCreateSchemaType,
    returningFields?: (keyof typeof QBCustomers)[],
  ) {
    console.info(
      'CustomerService#createQBCustomer | For client with Id =',
      payload.customerId,
    )
    const parsedInsertPayload = QBCustomerCreateSchema.parse(payload)
    const query = this.db.insert(QBCustomers).values(parsedInsertPayload)

    const [customer] = returningFields?.length
      ? await query.returning(
          buildReturningFields(QBCustomers, returningFields),
        )
      : await query.returning()

    return customer
  }

  async updateQBCustomer(
    payload: QBCustomerUpdateSchemaType,
    conditions: WhereClause,
    returningFields?: (keyof typeof QBCustomers)[],
  ) {
    console.info('CustomerService#updateQBCustomer')
    const parsedInsertPayload = QBCustomerUpdateSchema.parse(payload)

    const query = this.db
      .update(QBCustomers)
      .set(parsedInsertPayload)
      .where(conditions)

    const [customer] = returningFields?.length
      ? await query.returning(
          buildReturningFields(QBCustomers, returningFields),
        )
      : await query.returning()

    return customer
  }

  async getCustomerById(
    id: string,
    returningFields?: (keyof typeof QBCustomers)[],
  ) {
    let columns = null
    if (returningFields?.length) {
      columns = buildReturningFields(QBCustomers, returningFields, true)
    }

    return await this.db.query.QBCustomers.findFirst({
      where: (QBCustomers, { eq }) =>
        and(
          isNull(QBCustomers.deletedAt),
          eq(QBCustomers.id, id),
          eq(QBCustomers.portalId, this.user.workspaceId),
        ),
      ...(columns && { columns }),
    })
  }

  async getByClientCompanyId(
    clientCompanyId: string,
    returningFields?: (keyof typeof QBCustomers)[],
  ) {
    let columns = null
    if (returningFields?.length) {
      columns = buildReturningFields(QBCustomers, returningFields, true)
    }

    return await this.db.query.QBCustomers.findFirst({
      where: (QBCustomers, { eq }) =>
        and(
          isNull(QBCustomers.deletedAt),
          eq(QBCustomers.clientCompanyId, clientCompanyId),
          eq(QBCustomers.portalId, this.user.workspaceId),
        ),
      ...(columns && { columns }),
    })
  }

  private composeClientCompanyById(
    clientId: string,
    company: CompanyResponse | undefined,
  ) {
    if (clientId && company?.id && company.name) {
      return `${clientId}/${company?.id}`
    } else if (clientId) {
      return clientId
    }
  }

  /**
   * @param clientId will be empty when the invoice is billed to a company
   */
  async getRecipientInfo({
    clientId,
    companyId,
  }: {
    clientId: string
    companyId: string
  }) {
    if (!clientId && !companyId) {
      throw new APIError(
        httpStatus.BAD_REQUEST,
        'Either clientId or companyId must be provided',
      )
    }

    const copilot = new CopilotAPI(this.user.token)
    let client, company: CompanyResponse | undefined

    // get client and company info from copilot
    if (clientId) client = await copilot.getClient(clientId)
    if (companyId) company = await copilot.getCompany(companyId)

    let clientCompany: ClientCompanyType = {
      clientCompanyId:
        this.composeClientCompanyById(clientId, company) || companyId,
      recipientId: clientId || companyId, // TODO: remove everything related to this field. in case anything goes off the track
      companyId: '',
      displayName: '',
      type: 'client',
      email: '',
      givenName: '',
      familyName: '',
      companyName: '',
    }

    if (!client) {
      // NOTE: If company is not a valid company, company.name will be an empty string
      if (!company || !company.name) {
        console.info(
          'InvoiceService#handleInvoiceCreated | Could not retrieve client or company',
        )
        throw new APIError(
          httpStatus.NOT_FOUND,
          'Could not find client and company',
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
        clientCompany.type = 'company' as const
        clientCompany.companyId = company.id
        clientCompany.companyName = company.name
      } else {
        // if no, load data to create/update a customer with client info in Quickbooks
        const clients = await copilot.getClients({
          companyId: company.id,
        })

        if (!clients?.data || clients.data.length === 0) {
          throw new APIError(
            httpStatus.NOT_FOUND,
            `No clients found for company with Id: ${company.id}`,
          )
        }
        client = getLatestActiveClient(clients.data)
        clientCompany = {
          ...clientCompany,
          familyName: client.familyName,
          givenName: client.givenName,
          displayName: `${client.givenName} ${client.familyName} (${company.name})`,
          type: 'client' as const,
          email: client.email || '',
          companyId: company.id,
          companyName: company.name,
        }
      }
      return { recipientInfo: clientCompany, companyInfo: company }
    }

    let displayName = `${client.givenName} ${client.familyName}`
    /**
     * The following condition is to distinguish client from which company is billed.
     * In QB, the display name is unique, so we need to ensure that if the client has the same name in different companies,
     * we can distinguish them.
     */
    if (company && company.name) {
      displayName = `${client.givenName} ${client.familyName} - ${company.name}`
    }

    return {
      recipientInfo: {
        ...clientCompany,
        familyName: client?.familyName || '',
        givenName: client?.givenName || '',
        displayName,
        email: client?.email || '',
        companyId: client?.companyId || '',
      },
      companyInfo: company,
    }
  }
}
