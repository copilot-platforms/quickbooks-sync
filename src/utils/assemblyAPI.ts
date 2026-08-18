import { withRetry } from '@/app/api/core/utils/withRetry'
import {
  copilotAPIKey as apiKey,
  appId,
  externalFetchTimeoutMs,
} from '@/config'
import { buildHttpFetchError } from '@/helper/fetch.helper'
import {
  ClientRequest,
  ClientResponse,
  ClientResponseSchema,
  ClientsResponseSchema,
  CompaniesResponse,
  CompaniesResponseSchema,
  CompanyCreateRequest,
  CompanyResponse,
  CompanyResponseSchema,
  CopilotListArgs,
  CustomFieldResponse,
  CustomFieldResponseSchema,
  InternalUsers,
  InternalUsersResponse,
  InternalUsersResponseSchema,
  InternalUsersSchema,
  InvoiceResponse,
  InvoiceResponseSchema,
  NotificationCreatedResponse,
  NotificationCreatedResponseSchema,
  NotificationRequestBody,
  PaymentsResponse,
  PaymentsResponseSchema,
  PriceResponse,
  PriceResponseSchema,
  ProductResponse,
  ProductResponseSchema,
  ProductsResponse,
  ProductsResponseSchema,
  WorkspaceResponse,
  WorkspaceResponseSchema,
} from '@/type/common'
import Bottleneck from 'bottleneck'
import type { AssemblyAPI as SDK } from '@assembly-js/node-sdk'
import { assemblyApi } from '@assembly-js/node-sdk'
import { z } from 'zod'
import { API_DOMAIN } from '@/constant/domains'
import httpStatus from 'http-status'
import {
  MAX_ASSEMBLY_RESOURCE_LIST_LIMIT,
  MAX_INVOICE_LIST_LIMIT,
} from '@/app/api/core/constants/limit'

export class AssemblyAPI {
  assembly: Promise<SDK>

  constructor(private workspaceId: string) {
    this.assembly = assemblyApi({ apiKey: `${this.workspaceId}/${apiKey}` })
  }

  private async manualFetch(
    route: string,
    query?: Record<string, string>,
    workspaceId?: string,
  ) {
    const url = new URL(`${API_DOMAIN}/v1/${route}`)
    if (query) {
      for (const key of Object.keys(query)) {
        url.searchParams.set(key, query[key])
      }
    }

    console.info(
      `AssemblyAPI#manualFetch | url = ${url}, apiKey = ${apiKey}, workspaceId = ${workspaceId}`,
    )

    const resp = await fetch(url, {
      headers: {
        'X-API-KEY': workspaceId ? `${workspaceId}/${apiKey}` : apiKey,
        accept: 'application/json',
      },
      signal: AbortSignal.timeout(externalFetchTimeoutMs),
    })

    if (!resp.ok) throw await buildHttpFetchError(resp, url.toString())

    return await resp.json()
  }

  async getSDK() {
    return await this.assembly
  }

  // NOTE: Any method prefixed with _ is a API method that doesn't implement retry & delay
  // NOTE: Any normal API method name implements `withRetry` with default config

  async _getWorkspace(): Promise<WorkspaceResponse> {
    console.info('AssemblyAPI#getWorkspace | workspaceId =', this.workspaceId)
    const sdk = await this.getSDK()
    return WorkspaceResponseSchema.parse(await sdk.retrieveWorkspace())
  }

  async _createClient(
    requestBody: ClientRequest,
    sendInvite: boolean = false,
  ): Promise<ClientResponse> {
    console.info('AssemblyAPI#createClient | workspaceId =', this.workspaceId)
    const sdk = await this.getSDK()
    return ClientResponseSchema.parse(
      await sdk.createClient({ sendInvite, requestBody }),
    )
  }

  /**
   * Get the client from copilot
   * Error handling: if copilot throws NOT FOUND error or BAD REQUEST error, return undefined. This is done as we don't want to terminate the process
   */
  async _getClient(id: string): Promise<ClientResponse | undefined> {
    const sdk = await this.getSDK()
    try {
      console.info('AssemblyAPI#getClient | workspaceId =', this.workspaceId)
      return ClientResponseSchema.parse(await sdk.retrieveClient({ id }))
    } catch (error: unknown) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'body' in error &&
        'status' in error &&
        typeof (error as any).body === 'object'
      ) {
        if (
          error.status === httpStatus.BAD_REQUEST ||
          error.status === httpStatus.NOT_FOUND
        ) {
          const errorBody = (error as { body: any }).body
          console.info('AssemblyAPI#getClient | message =', errorBody.message)
          return
        }
      }
      throw error
    }
  }

  /**
   * Get the clients from copilot
   * Error handling: if copilot throws NOT FOUND error or BAD REQUEST error, return undefined. This is done as we don't want to terminate the process
   */
  async _getClients(args: CopilotListArgs & { companyId?: string } = {}) {
    const sdk = await this.getSDK()
    try {
      console.info('AssemblyAPI#getClients | workspaceId =', this.workspaceId)
      return ClientsResponseSchema.parse(await sdk.listClients(args))
    } catch (error: unknown) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'body' in error &&
        'status' in error &&
        typeof (error as any).body === 'object'
      ) {
        if (
          error.status === httpStatus.BAD_REQUEST ||
          error.status === httpStatus.NOT_FOUND
        ) {
          const errorBody = (error as { body: any }).body
          console.info('AssemblyAPI#getClients | message =', errorBody.message)
          return
        }
      }
      throw error
    }
  }

  async _updateClient(
    id: string,
    requestBody: ClientRequest,
  ): Promise<ClientResponse> {
    console.info('AssemblyAPI#updateClient | workspaceId =', this.workspaceId)
    const sdk = await this.getSDK()
    return ClientResponseSchema.parse(
      await sdk.updateClient({ id, requestBody }),
    )
  }

  async _deleteClient(id: string) {
    console.info('AssemblyAPI#deleteClient | workspaceId =', this.workspaceId)
    const sdk = await this.getSDK()
    return await sdk.deleteClient({ id })
  }

  async _createCompany(requestBody: CompanyCreateRequest) {
    console.info('AssemblyAPI#createCompany | token =', this.workspaceId)
    const sdk = await this.getSDK()
    return CompanyResponseSchema.parse(await sdk.createCompany({ requestBody }))
  }

  /**
   * Get the company from copilot
   * Error handling: if copilot throws NOT FOUND error or BAD REQUEST error, return undefined. This is done as we don't want to terminate the process
   */
  async _getCompany(id: string): Promise<CompanyResponse | undefined> {
    try {
      console.info('AssemblyAPI#getCompany | token =', this.workspaceId)
      const sdk = await this.getSDK()
      return CompanyResponseSchema.parse(await sdk.retrieveCompany({ id }))
    } catch (error: unknown) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'body' in error &&
        'status' in error &&
        typeof (error as any).body === 'object'
      ) {
        if (
          error.status === httpStatus.BAD_REQUEST ||
          error.status === httpStatus.NOT_FOUND
        ) {
          const errorBody = (error as { body: any }).body
          console.info('AssemblyAPI#getCompany | message =', errorBody.message)
          return
        }
      }
      throw error
    }
  }

  async _getCompanies(args: CopilotListArgs = {}): Promise<CompaniesResponse> {
    console.info('AssemblyAPI#getCompanies | token =', this.workspaceId)
    const sdk = await this.getSDK()
    return CompaniesResponseSchema.parse(await sdk.listCompanies(args))
  }

  async _getCompanyClients(companyId: string): Promise<ClientResponse[]> {
    console.info('AssemblyAPI#getCompanyClients | token =', this.workspaceId)
    return (await this.getClients({ limit: 10000, companyId }))?.data || []
  }

  async _getCustomFields(): Promise<CustomFieldResponse> {
    console.info('AssemblyAPI#getCustomFields | token =', this.workspaceId)
    const sdk = await this.getSDK()
    return CustomFieldResponseSchema.parse(await sdk.listCustomFields({}))
  }

  async _getInternalUsers(
    args: CopilotListArgs = {},
  ): Promise<InternalUsersResponse> {
    console.info('AssemblyAPI#getInternalUsers | token =', this.workspaceId)
    const sdk = await this.getSDK()
    return InternalUsersResponseSchema.parse(await sdk.listInternalUsers(args))
  }

  async _getInternalUser(id: string): Promise<InternalUsers> {
    console.info('AssemblyAPI#getInternalUser | token =', this.workspaceId)
    const sdk = await this.getSDK()
    return InternalUsersSchema.parse(await sdk.retrieveInternalUser({ id }))
  }

  async _createNotification(
    requestBody: NotificationRequestBody,
  ): Promise<NotificationCreatedResponse> {
    console.info('AssemblyAPI#createNotification | token =', this.workspaceId)
    console.info('AssemblyAPI#createNotification | requestBody =', requestBody)
    const sdk = await this.getSDK()
    return NotificationCreatedResponseSchema.parse(
      await sdk.createNotification({
        requestBody,
      }),
    )
  }

  async _markNotificationAsRead(id: string): Promise<void> {
    console.info(
      'AssemblyAPI#markNotificationAsRead | token =',
      this.workspaceId,
    )
    const sdk = await this.getSDK()
    await sdk.markNotificationRead({ id })
  }

  async _bulkMarkNotificationsAsRead(notificationIds: string[]): Promise<void> {
    console.info(
      'AssemblyAPI#markNotificationAsRead | token =',
      this.workspaceId,
    )
    const markAsReadPromises = []
    const bottleneck = new Bottleneck({ minTime: 250, maxConcurrent: 2 })

    for (const notification of notificationIds) {
      markAsReadPromises.push(
        bottleneck
          .schedule(() => {
            return this.markNotificationAsRead(notification)
          })
          .catch((err: unknown) =>
            console.error(
              `Failed to delete notification with id ${notification}`,
              err,
            ),
          ),
      )
    }

    await Promise.all(markAsReadPromises)
  }

  async _deleteNotification(id: string): Promise<void> {
    console.info('AssemblyAPI#deleteNotification | token =', this.workspaceId)
    const sdk = await this.getSDK()
    await sdk.deleteNotification({ id })
  }

  async _bulkDeleteNotifications(notificationIds: string[]): Promise<void> {
    console.info('AssemblyAPI#deleteNotification | token =', this.workspaceId)
    const deletePromises = []
    const bottleneck = new Bottleneck({ minTime: 250, maxConcurrent: 2 })
    for (const notification of notificationIds) {
      deletePromises.push(
        bottleneck
          .schedule(() => {
            return this.deleteNotification(notification)
          })
          .catch((err: unknown) =>
            console.error(
              `Failed to delete notification with id ${notification}`,
              err,
            ),
          ),
      )
    }
    await Promise.all(deletePromises)
  }

  async getNotifications(
    recipientId: string,
    opts: { limit?: number } = { limit: 100 },
  ) {
    const data = await this.manualFetch('notifications', {
      recipientId,
      limit: `${opts.limit}`,
    })
    const notifications = z
      .array(NotificationCreatedResponseSchema)
      .parse(data.data)
    // Return only all notifications triggered by quickbooks-sync-app
    return notifications.filter(
      (notification) =>
        notification.appId ===
        z
          .string()
          .min(1, { message: 'Missing AppID in environment' })
          .parse(appId),
    )
  }

  async _getProduct(id: string): Promise<ProductResponse | undefined> {
    console.info('AssemblyAPI#getProduct | token =', this.workspaceId)
    const sdk = await this.getSDK()
    return ProductResponseSchema.parse(await sdk.retrieveProduct({ id }))
  }

  async _getProducts({
    name,
    nextToken,
    limit,
  }: {
    name?: string
    nextToken?: string
    limit?: number
  }): Promise<ProductsResponse | undefined> {
    console.info('AssemblyAPI#getProducts | token =', this.workspaceId)
    const sdk = await this.getSDK()
    return ProductsResponseSchema.parse(
      await sdk.listProducts({ name, nextToken, limit }),
    )
  }

  async _getPrice(id: string): Promise<PriceResponse | undefined> {
    console.info('AssemblyAPI#getPrice | token =', this.workspaceId)
    const sdk = await this.getSDK()
    return PriceResponseSchema.parse(await sdk.retrievePrice({ id }))
  }

  async _getInvoice(id: string): Promise<InvoiceResponse | undefined> {
    console.info('AssemblyAPI#getInvoice | token =', this.workspaceId)
    const sdk = await this.getSDK()
    return InvoiceResponseSchema.parse(await sdk.retrieveInvoice({ id }))
  }

  async _getInvoices(
    workspaceId?: string,
  ): Promise<InvoiceResponse[] | undefined> {
    console.info('AssemblyAPI#getInvoices | token =', this.workspaceId)
    const data = await this.manualFetch(
      'invoices',
      {
        limit: MAX_INVOICE_LIST_LIMIT.toString(),
      },
      workspaceId,
    )

    console.info(`AssemblyAPI#getInvoices | data length = ${data.data?.length}`)
    return z.array(InvoiceResponseSchema).parse(data.data)
  }

  async _getPayments(
    invoiceId?: string,
  ): Promise<PaymentsResponse | undefined> {
    console.info('AssemblyAPI#getPayments | token =', this.workspaceId)
    const sdk = await this.getSDK()
    return PaymentsResponseSchema.parse(
      await sdk.listPayments({
        invoiceId,
        limit: MAX_ASSEMBLY_RESOURCE_LIST_LIMIT,
      }),
    )
  }

  private wrapWithRetry<Args extends unknown[], R>(
    fn: (...args: Args) => Promise<R>,
  ): (...args: Args) => Promise<R> {
    return (...args: Args): Promise<R> => withRetry(fn.bind(this), args)
  }

  // Methods wrapped with retry
  getWorkspace = this.wrapWithRetry(this._getWorkspace)
  createClient = this.wrapWithRetry(this._createClient)
  getClient = this.wrapWithRetry(this._getClient)
  getClients = this.wrapWithRetry(this._getClients)
  updateClient = this.wrapWithRetry(this._updateClient)
  deleteClient = this.wrapWithRetry(this._deleteClient)
  createCompany = this.wrapWithRetry(this._createCompany)
  getCompany = this.wrapWithRetry(this._getCompany)
  getCompanies = this.wrapWithRetry(this._getCompanies)
  getCompanyClients = this.wrapWithRetry(this._getCompanyClients)
  getCustomFields = this.wrapWithRetry(this._getCustomFields)
  getInternalUsers = this.wrapWithRetry(this._getInternalUsers)
  getInternalUser = this.wrapWithRetry(this._getInternalUser)
  createNotification = this.wrapWithRetry(this._createNotification)
  markNotificationAsRead = this.wrapWithRetry(this._markNotificationAsRead)
  bulkMarkNotificationsAsRead = this.wrapWithRetry(
    this._bulkMarkNotificationsAsRead,
  )
  bulkDeleteNotifications = this.wrapWithRetry(this._bulkDeleteNotifications)
  deleteNotification = this.wrapWithRetry(this._deleteNotification)
  getProduct = this.wrapWithRetry(this._getProduct)
  getProducts = this.wrapWithRetry(this._getProducts)
  getPrice = this.wrapWithRetry(this._getPrice)
  getInvoice = this.wrapWithRetry(this._getInvoice)
  getInvoices = this.wrapWithRetry(this._getInvoices)
  getPayments = this.wrapWithRetry(this._getPayments)
}
