import { withRetry } from '@/app/api/core/utils/withRetry'
import { copilotAPIKey as apiKey, appId } from '@/config'
import {
  ClientRequest,
  ClientResponse,
  ClientResponseSchema,
  ClientsResponseSchema,
  ClientToken,
  ClientTokenSchema,
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
  IUToken,
  IUTokenSchema,
  MeResponse,
  MeResponseSchema,
  NotificationCreatedResponse,
  NotificationCreatedResponseSchema,
  NotificationRequestBody,
  PriceResponse,
  PriceResponseSchema,
  PricesResponse,
  PricesResponseSchema,
  ProductResponse,
  ProductResponseSchema,
  ProductsResponse,
  ProductsResponseSchema,
  Token,
  TokenSchema,
  WorkspaceResponse,
  WorkspaceResponseSchema,
} from '@/type/common'
import Bottleneck from 'bottleneck'
import type { CopilotAPI as SDK } from 'copilot-node-sdk'
import { copilotApi } from 'copilot-node-sdk'
import { z } from 'zod'
import { API_DOMAIN } from '@/constant/domains'
import httpStatus from 'http-status'
import { MAX_INVOICE_LIST_LIMIT } from '@/app/api/core/constants/limit'

export class CopilotAPI {
  copilot: SDK

  constructor(private token: string) {
    this.copilot = copilotApi({ apiKey, token })
  }

  private async manualFetch(route: string, query?: Record<string, string>) {
    const url = new URL(`${API_DOMAIN}/v1/${route}`)
    if (query) {
      for (const key of Object.keys(query)) {
        url.searchParams.set(key, query[key])
      }
    }
    const resp = await fetch(url, {
      headers: { 'X-API-KEY': apiKey, accept: 'application/json' },
    })
    return await resp.json()
  }

  // NOTE: Any method prefixed with _ is a API method that doesn't implement retry & delay
  // NOTE: Any normal API method name implements `withRetry` with default config

  // Get Token Payload from copilot request token
  async _getTokenPayload(): Promise<Token | null> {
    const getTokenPayload = this.copilot.getTokenPayload
    if (!getTokenPayload) {
      console.error(
        `CopilotAPI#getTokenPayload | Could not parse token payload for token ${this.token}`,
      )
      return null
    }

    return TokenSchema.parse(await getTokenPayload())
  }

  async _me(): Promise<MeResponse | null> {
    console.info('CopilotAPI#me | token =', this.token)
    const tokenPayload = await this.getTokenPayload()
    const id = tokenPayload?.internalUserId || tokenPayload?.clientId
    if (!tokenPayload || !id) return null

    const retrieveCurrentUserInfo = tokenPayload.internalUserId
      ? this.copilot.retrieveInternalUser
      : this.copilot.retrieveClient
    const currentUserInfo = await retrieveCurrentUserInfo({ id })

    return MeResponseSchema.parse(currentUserInfo)
  }

  async _getWorkspace(): Promise<WorkspaceResponse> {
    console.info('CopilotAPI#getWorkspace | token =', this.token)
    return WorkspaceResponseSchema.parse(await this.copilot.retrieveWorkspace())
  }

  async _getClientTokenPayload(): Promise<ClientToken | null> {
    console.info('CopilotAPI#getClientTokenPayload | token =', this.token)
    const tokenPayload = await this.getTokenPayload()
    if (!tokenPayload) return null

    return ClientTokenSchema.parse(tokenPayload)
  }

  async _getIUTokenPayload(): Promise<IUToken | null> {
    console.info('CopilotAPI#getIUTokenPayload | token =', this.token)
    const tokenPayload = await this.getTokenPayload()
    if (!tokenPayload) return null

    return IUTokenSchema.parse(tokenPayload)
  }

  async _createClient(
    requestBody: ClientRequest,
    sendInvite: boolean = false,
  ): Promise<ClientResponse> {
    console.info('CopilotAPI#createClient | token =', this.token)
    return ClientResponseSchema.parse(
      await this.copilot.createClient({ sendInvite, requestBody }),
    )
  }

  /**
   * Get the client from copilot
   * Error handling: if copilot throws NOT FOUND error or BAD REQUEST error, return undefined. This is done as we don't want to terminate the process
   */
  async _getClient(id: string): Promise<ClientResponse | undefined> {
    try {
      console.info('CopilotAPI#getClient | token =', this.token)
      return ClientResponseSchema.parse(
        await this.copilot.retrieveClient({ id }),
      )
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
          console.info('CopilotAPI#getClient | message =', errorBody.message)
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
    try {
      console.info('CopilotAPI#getClients | token =', this.token)
      return ClientsResponseSchema.parse(await this.copilot.listClients(args))
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
          console.info('CopilotAPI#getClients | message =', errorBody.message)
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
    console.info('CopilotAPI#updateClient | token =', this.token)
    return ClientResponseSchema.parse(
      await this.copilot.updateClient({ id, requestBody }),
    )
  }

  async _deleteClient(id: string) {
    console.info('CopilotAPI#deleteClient | token =', this.token)
    return await this.copilot.deleteClient({ id })
  }

  async _createCompany(requestBody: CompanyCreateRequest) {
    console.info('CopilotAPI#createCompany | token =', this.token)
    return CompanyResponseSchema.parse(
      await this.copilot.createCompany({ requestBody }),
    )
  }

  /**
   * Get the company from copilot
   * Error handling: if copilot throws NOT FOUND error or BAD REQUEST error, return undefined. This is done as we don't want to terminate the process
   */
  async _getCompany(id: string): Promise<CompanyResponse | undefined> {
    try {
      console.info('CopilotAPI#getCompany | token =', this.token)
      return CompanyResponseSchema.parse(
        await this.copilot.retrieveCompany({ id }),
      )
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
          console.info('CopilotAPI#getCompany | message =', errorBody.message)
          return
        }
      }
      throw error
    }
  }

  async _getCompanies(args: CopilotListArgs = {}): Promise<CompaniesResponse> {
    console.info('CopilotAPI#getCompanies | token =', this.token)
    return CompaniesResponseSchema.parse(await this.copilot.listCompanies(args))
  }

  async _getCompanyClients(companyId: string): Promise<ClientResponse[]> {
    console.info('CopilotAPI#getCompanyClients | token =', this.token)
    return (await this.getClients({ limit: 10000, companyId }))?.data || []
  }

  async _getCustomFields(): Promise<CustomFieldResponse> {
    console.info('CopilotAPI#getCustomFields | token =', this.token)
    return CustomFieldResponseSchema.parse(
      await this.copilot.listCustomFields(),
    )
  }

  async _getInternalUsers(
    args: CopilotListArgs = {},
  ): Promise<InternalUsersResponse> {
    console.info('CopilotAPI#getInternalUsers | token =', this.token)
    return InternalUsersResponseSchema.parse(
      await this.copilot.listInternalUsers(args),
    )
  }

  async _getInternalUser(id: string): Promise<InternalUsers> {
    console.info('CopilotAPI#getInternalUser | token =', this.token)
    return InternalUsersSchema.parse(
      await this.copilot.retrieveInternalUser({ id }),
    )
  }

  async _createNotification(
    requestBody: NotificationRequestBody,
  ): Promise<NotificationCreatedResponse> {
    console.info('CopilotAPI#createNotification | token =', this.token)
    console.info('CopilotAPI#createNotification | requestBody =', requestBody)
    return NotificationCreatedResponseSchema.parse(
      await this.copilot.createNotification({
        requestBody,
      }),
    )
  }

  async _markNotificationAsRead(id: string): Promise<void> {
    console.info('CopilotAPI#markNotificationAsRead | token =', this.token)
    await this.copilot.markNotificationRead({ id })
  }

  async _bulkMarkNotificationsAsRead(notificationIds: string[]): Promise<void> {
    console.info('CopilotAPI#markNotificationAsRead | token =', this.token)
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
    console.info('CopilotAPI#deleteNotification | token =', this.token)
    await this.copilot.deleteNotification({ id })
  }

  async _bulkDeleteNotifications(notificationIds: string[]): Promise<void> {
    console.info('CopilotAPI#deleteNotification | token =', this.token)
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
    console.info('CopilotAPI#getProduct | token =', this.token)
    return ProductResponseSchema.parse(
      await this.copilot.retrieveProduct({ id }),
    )
  }

  async _getProducts(
    name?: string,
    nextToken?: string,
    limit?: number,
  ): Promise<ProductsResponse | undefined> {
    console.info('CopilotAPI#getProducts | token =', this.token)
    return ProductsResponseSchema.parse(
      await this.copilot.listProducts({ name, nextToken, limit }),
    )
  }

  async _getPrice(id: string): Promise<PriceResponse | undefined> {
    console.info('CopilotAPI#getPrice | token =', this.token)
    return PriceResponseSchema.parse(await this.copilot.retrievePrice({ id }))
  }

  async _getPrices(
    productId?: string,
    nextToken?: string,
    limit?: string,
  ): Promise<PricesResponse | undefined> {
    console.info('CopilotAPI#getPrices | token =', this.token)
    return PricesResponseSchema.parse(
      await this.copilot.listPrices({ productId, nextToken, limit }),
    )
  }

  async _getInvoice(id: string): Promise<InvoiceResponse | undefined> {
    console.info('CopilotAPI#getInvoice | token =', this.token)
    return InvoiceResponseSchema.parse(
      await this.copilot.retrieveInvoice({ id }),
    )
  }

  async _getInvoices(): Promise<InvoiceResponse[] | undefined> {
    console.info('CopilotAPI#getInvoices | token =', this.token)
    const data = await this.manualFetch('invoices', {
      limit: MAX_INVOICE_LIST_LIMIT.toString(),
    })

    return z.array(InvoiceResponseSchema).parse(data.data)
  }

  private wrapWithRetry<Args extends unknown[], R>(
    fn: (...args: Args) => Promise<R>,
  ): (...args: Args) => Promise<R> {
    return (...args: Args): Promise<R> => withRetry(fn.bind(this), args)
  }

  // Methods wrapped with retry
  getTokenPayload = this.wrapWithRetry(this._getTokenPayload)
  me = this.wrapWithRetry(this._me)
  getWorkspace = this.wrapWithRetry(this._getWorkspace)
  getClientTokenPayload = this.wrapWithRetry(this._getClientTokenPayload)
  getIUTokenPayload = this.wrapWithRetry(this._getIUTokenPayload)
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
  getPrices = this.wrapWithRetry(this._getPrices)
  getInvoice = this.wrapWithRetry(this._getInvoice)
  getInvoices = this.wrapWithRetry(this._getInvoices)
}
