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
import { QBCustomerCreatePayloadType } from '@/type/dto/intuitAPI.dto'
import { InvoiceCreatedResponseType } from '@/type/dto/webhook.dto'
import { CopilotAPI } from '@/utils/copilotAPI'
import IntuitAPI from '@/utils/intuitAPI'
import { addSyncBreadcrumb } from '@/utils/sentry'
import { getNameAsCustomer, replaceSpecialCharsForQB } from '@/utils/string'
import { and, eq, isNull } from 'drizzle-orm'
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
    customerType: 'client' | 'company',
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
          eq(QBCustomers.customerType, customerType),
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
    let client

    // get client and company info from copilot
    if (clientId) client = await copilot.getClient(clientId)
    const company = await copilot.getCompany(companyId)

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
        clientCompany.type = 'company'
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
          email: client.email,
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
        familyName: client.familyName,
        givenName: client.givenName,
        displayName,
        email: client.email,
        companyId: client.companyId,
        companyName: company?.name || '',
      },
      companyInfo: company,
    }
  }

  async updateCustomerSyncToken(
    mapId: string,
    qbCustomerId: string,
    intuitApi: IntuitAPI,
  ) {
    console.info(
      'CustomerService#updateCustomerSyncToken. Updating sync token ...',
    )

    // 1. get customer by ID
    let customer = await intuitApi.getACustomer(undefined, qbCustomerId, true)

    if (!customer) {
      console.info(
        `CustomerService#updateCustomerSyncToken. Customer not found for Id ${qbCustomerId} in QuickBooks. Unmapping the customer...`,
      )
      // await this.removeCustomerMapping(mapId)
      return
    } else if (!customer.Active) {
      console.info(
        `CustomerService#updateCustomerSyncToken. Customer with Id ${qbCustomerId} is inactive. Making it active...`,
      )
      // if customer is inactive, make it active
      const updateRes = await intuitApi.customerSparseUpdate({
        Id: customer.Id,
        SyncToken: customer.SyncToken,
        Active: true,
        sparse: true,
      })
      customer = updateRes
    }

    // 2. update sync token in customer sync table
    const updateCustomer = await this.updateQBCustomer(
      {
        qbSyncToken: customer.SyncToken,
      },
      and(
        eq(QBCustomers.id, mapId),
        eq(QBCustomers.portalId, this.user.workspaceId),
      ) as WhereClause,
    )

    console.info(
      'CustomerService#updateCustomerSyncToken. Sync token updated ...',
    )

    return updateCustomer
  }

  async removeCustomerMapping(id: string) {
    await this.db
      .update(QBCustomers)
      .set({
        deletedAt: new Date(),
      })
      .where(eq(QBCustomers.id, id))
  }

  async ensureCustomerExistsAndSyncToken(
    clientCompanyId: string,
    customerType: 'client' | 'company',
    intuitApi: IntuitAPI,
  ) {
    const existingCustomer = await this.getExistingCustomer(
      clientCompanyId,
      customerType,
    )

    if (!existingCustomer) return

    return await this.updateCustomerSyncToken(
      existingCustomer.id,
      existingCustomer.qbCustomerId,
      intuitApi,
    )
  }

  async getExistingCustomer(
    clientCompanyId: string,
    customerType: 'client' | 'company',
  ) {
    return await this.getByClientCompanyId(clientCompanyId, customerType, [
      'id',
      'qbCustomerId',
      'qbSyncToken',
      'familyName',
      'givenName',
      'email',
      'companyName',
      'displayName',
    ])
  }

  async findOrCreateCustomer({
    intuitApiService,
    recipientInfo,
    companyInfo,
    invoiceResource,
  }: {
    intuitApiService: IntuitAPI
    recipientInfo: ClientCompanyType
    companyInfo: CompanyResponse | undefined
    invoiceResource: InvoiceCreatedResponseType['data']
  }) {
    const displayName = recipientInfo.displayName
    // 2.1. search client in qb using recipient's email or display name
    let customer = recipientInfo.email
      ? await intuitApiService.getCustomerByEmail(recipientInfo.email)
      : await intuitApiService.getACustomer(
          replaceSpecialCharsForQB(recipientInfo.displayName),
          undefined,
          true,
        )

    // 2.2. verify the matched customer has the same company name. This is needed because a single customer with same email can be part of multiple companies
    const sanitizedCompanyName = recipientInfo.companyName
      ? replaceSpecialCharsForQB(recipientInfo.companyName)
      : undefined
    if (
      customer &&
      (customer.CompanyName || undefined) !== sanitizedCompanyName
    ) {
      customer = undefined
    }

    addSyncBreadcrumb('Customer search in QBO', {
      found: !!customer,
    })

    // 3. if not found, create a new client in the QB
    if (!customer) {
      console.info(
        `InvoiceService#WebhookInvoiceCreated | Customer named ${recipientInfo.displayName} not found in QB. Creating new customer...`,
      )
      // Create a new customer in QB
      const sanitizedDisplayName = replaceSpecialCharsForQB(displayName)

      // QB enforces DisplayName uniqueness across Customer, Vendor, and Employee.
      // If the name collides with a Vendor/Employee, suffix it to avoid error 6240.
      const collision =
        await intuitApiService.getNameCollisionEntity(sanitizedDisplayName)
      const finalDisplayName = collision
        ? getNameAsCustomer(sanitizedDisplayName)
        : sanitizedDisplayName

      if (collision) {
        console.info(
          `InvoiceService#WebhookInvoiceCreated | DisplayName "${sanitizedDisplayName}" collides with existing ${collision.type} (Id: ${collision.id}). Using "${finalDisplayName}" instead.`,
        )
      }

      let customerPayload: QBCustomerCreatePayloadType = {
        DisplayName: finalDisplayName,
        CompanyName: companyInfo && replaceSpecialCharsForQB(companyInfo.name),
        PrimaryEmailAddr: {
          Address: recipientInfo.email,
        },
      }

      if (recipientInfo.givenName && recipientInfo.familyName) {
        customerPayload = {
          ...customerPayload,
          GivenName: replaceSpecialCharsForQB(recipientInfo.givenName),
          FamilyName: replaceSpecialCharsForQB(recipientInfo.familyName),
        }
      }

      const customerRes = await intuitApiService.createCustomer(customerPayload)
      customer = customerRes

      addSyncBreadcrumb('Customer created in QBO', {
        qbCustomerId: customer.Id,
      })
      console.info(
        `InvoiceService#WebhookInvoiceCreated | Customer created in QB with ID: ${customer.Id}.`,
      )
    }

    // create map for customer into mapping table
    // NOTE: displayName here is the Copilot-side name (may differ from the QB
    // DisplayName when a collision suffix was applied). The source of truth
    // for the QB record's DisplayName is QB itself (fetched via qbCustomerId).
    const customerSync = await this.createQBCustomer({
      portalId: this.user.workspaceId,
      customerId: recipientInfo.recipientId, // TODO: remove everything related to this field. in case anything goes off the track
      clientCompanyId: recipientInfo.clientCompanyId,
      clientId: invoiceResource.clientId || null,
      companyId: invoiceResource.companyId || null,
      givenName: recipientInfo.givenName,
      familyName: recipientInfo.familyName,
      displayName: recipientInfo.displayName,
      email: recipientInfo.email,
      companyName: companyInfo?.name,
      customerType: recipientInfo.type,
      qbSyncToken: customer.SyncToken,
      qbCustomerId: customer.Id,
    })

    return { customer, customerSyncId: customerSync.id }
  }
}
