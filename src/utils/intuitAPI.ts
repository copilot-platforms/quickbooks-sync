import APIError from '@/app/api/core/exceptions/api'
import { withRetry } from '@/app/api/core/utils/withRetry'
import { intuitApiMinorVersion, intuitBaseUrl } from '@/config'
import { QBTokenSelectSchemaType } from '@/db/schema/qbTokens'
import { getFetcher, postFetcher } from '@/helper/fetch.helper'
import {
  QBCustomerCreatePayloadType,
  QBCustomerSparseUpdatePayloadType,
  QBInvoiceCreatePayloadType,
  QBItemCreatePayloadType,
  QBInvoiceSparseUpdatePayloadType,
  QBItemFullUpdatePayloadType,
  QBPaymentCreatePayloadType,
} from '@/type/dto/intuitAPI.dto'
import httpStatus from 'http-status'

export type IntuitAPITokensType = Pick<
  QBTokenSelectSchemaType,
  'accessToken' | 'refreshToken' | 'intuitRealmId' | 'incomeAccountRef'
>

export default class IntuitAPI {
  tokens: IntuitAPITokensType
  private static headers: Record<string, string>

  constructor(tokens: IntuitAPITokensType) {
    this.tokens = tokens
    this.setHeaders()
  }

  private setHeaders() {
    IntuitAPI.headers = {
      Authorization: `Bearer ${this.tokens.accessToken}`,
      Accept: 'application/json',
      'content-type': 'application/json',
    }
  }

  /**
   * This function is used to make a POST request to Intuit API with necessary authorization headers
   */
  private async postFetchWithHeaders(
    url: string,
    body: Record<string, any>,
    customHeaders?: Record<string, string>,
  ) {
    const headers = {
      ...IntuitAPI.headers,
      ...customHeaders,
    }
    const response = await postFetcher(url, headers, body)
    return response
  }

  /**
   * This function is used to make a GET request to Intuit API with necessary authorization headers
   */
  private async getFetchWithHeader(
    url: string,
    customHeaders?: Record<string, string>,
  ) {
    const headers = {
      ...IntuitAPI.headers,
      ...customHeaders,
    }
    const response = await getFetcher(url, headers)
    return response
  }

  async _customQuery(query: string) {
    console.log('IntuitAPI#customQuery')
    const url = `${intuitBaseUrl}/v3/company/${this.tokens.intuitRealmId}/query?query=${query}&minorversion=${intuitApiMinorVersion}`
    const res = await this.getFetchWithHeader(url)

    if (!res)
      throw new APIError(
        httpStatus.BAD_REQUEST,
        'IntuitAPI#customQuery | message = no response',
      )

    if (res?.Fault) {
      console.error({ Error: res.Fault?.Error })
      throw new APIError(
        httpStatus.BAD_REQUEST,
        'IntuitAPI#customQuery | Error while executing custom query',
        res.Fault?.Error,
      )
    }
    return res.QueryResponse
  }

  async _createInvoice(payload: QBInvoiceCreatePayloadType) {
    console.log('IntuitAPI#createInvoice | invoice creation start')
    const url = `${intuitBaseUrl}/v3/company/${this.tokens.intuitRealmId}/invoice?minorversion=${intuitApiMinorVersion}`
    const invoice = await this.postFetchWithHeaders(url, payload)

    if (!invoice)
      throw new APIError(
        httpStatus.BAD_REQUEST,
        'IntuitAPI#createInvoice | message = no response',
      )

    if (invoice?.Fault) {
      console.error({ Error: invoice.Fault?.Error })
      throw new APIError(
        httpStatus.BAD_REQUEST,
        'IntuitAPI#createInvoice | Error while creating invoice',
        invoice.Fault?.Error,
      )
    }

    console.log(
      'IntuitAPI#createInvoice | invoice created with doc number=',
      invoice.Invoice?.DocNumber,
    )
    return invoice
  }

  async _createCustomer(payload: QBCustomerCreatePayloadType) {
    console.log('IntuitAPI#createCustomer | customer creation start')
    const url = `${intuitBaseUrl}/v3/company/${this.tokens.intuitRealmId}/customer?minorversion=${intuitApiMinorVersion}`
    const customer = await this.postFetchWithHeaders(url, payload)

    if (!customer)
      throw new APIError(
        httpStatus.BAD_REQUEST,
        'IntuitAPI#createCustomer | message = no response',
      )

    if (customer?.Fault) {
      console.error({ Error: customer.Fault?.Error })
      throw new APIError(
        httpStatus.BAD_REQUEST,
        'IntuitAPI#createCustomer | Error while creating customer',
        customer.Fault?.Error,
      )
    }

    console.log(
      'IntuitAPI#createCustomer | customer created with name=',
      customer.Customer?.FullyQualifiedName,
    )
    return customer
  }

  async _createItem(payload: QBItemCreatePayloadType) {
    console.log('IntuitAPI#createItem | Item creation start')
    const url = `${intuitBaseUrl}/v3/company/${this.tokens.intuitRealmId}/item?minorversion=${intuitApiMinorVersion}`
    const item = await this.postFetchWithHeaders(url, payload)

    if (!item)
      throw new APIError(
        httpStatus.BAD_REQUEST,
        'IntuitAPI#createItem | message = no response',
      )

    if (item?.Fault) {
      console.error({ Error: item.Fault?.Error })
      throw new APIError(
        httpStatus.BAD_REQUEST,
        'IntuitAPI#createItem | Error while creating item',
        item.Fault?.Error,
      )
    }

    console.log('IntuitAPI#createItem | item created with Id =', item?.Item?.Id)
    return item.Item
  }

  async _getSingleIncomeAccount() {
    const sqlQuery = `SELECT Id FROM Account WHERE AccountType = 'Income' AND AccountSubType = 'SalesOfProductIncome' AND Active = true maxresults 1`
    const qbIncomeAccountRefInfo = await this.customQuery(sqlQuery)

    if (!qbIncomeAccountRefInfo)
      throw new APIError(
        httpStatus.BAD_REQUEST,
        'IntuitAPI#getSingleIncomeAccount | message = no response',
      )

    if (qbIncomeAccountRefInfo?.Fault) {
      console.error({ Error: qbIncomeAccountRefInfo.Fault?.Error })
      throw new APIError(
        httpStatus.BAD_REQUEST,
        'IntuitAPI#getSingleIncomeAccount | Error while fetching income account',
        qbIncomeAccountRefInfo.Fault?.Error,
      )
    }

    return qbIncomeAccountRefInfo.Account?.[0]
  }

  async _getACustomer(givenName: string, familyName: string) {
    const customerQuery = `SELECT Id, SyncToken FROM Customer WHERE GivenName = '${givenName}' AND FamilyName = '${familyName}' AND Active = true`
    const qbCustomers = await this.customQuery(customerQuery)

    if (!qbCustomers)
      throw new APIError(
        httpStatus.BAD_REQUEST,
        'IntuitAPI#getACustomer | message = no response',
      )

    if (qbCustomers?.Fault) {
      console.error({ Error: qbCustomers.Fault?.Error })
      throw new APIError(
        httpStatus.BAD_REQUEST,
        'IntuitAPI#getACustomer | Error while fetching a customer',
        qbCustomers.Fault?.Error,
      )
    }

    return qbCustomers.Customer?.[0]
  }

  async _getAnItem(name: string) {
    const customerQuery = `select Id, SyncToken from Item where Name = '${name}' maxresults 1`
    const qbItem = await this.customQuery(customerQuery)

    if (!qbItem)
      throw new APIError(
        httpStatus.BAD_REQUEST,
        'IntuitAPI#getAnItem | message = no response',
      )

    if (qbItem?.Fault) {
      console.error({ Error: qbItem.Fault?.Error })
      throw new APIError(
        httpStatus.BAD_REQUEST,
        'IntuitAPI#getAnItem | Error while fetching an item',
        qbItem.Fault?.Error,
      )
    }

    return qbItem.Item?.[0]
  }

  async _getAllItems(limit: number, columns: string[] = ['Id']) {
    const stringColumns = columns.map((column) => `${column}`).join(',')
    const customerQuery = `select ${stringColumns} from Item maxresults ${limit}`
    console.log({ customerQuery })
    const qbItems = await this.customQuery(customerQuery)

    if (!qbItems)
      throw new APIError(
        httpStatus.BAD_REQUEST,
        'IntuitAPI#getAllItems | message = no response',
      )

    if (qbItems?.Fault) {
      console.error({ Error: qbItems.Fault?.Error })
      throw new APIError(
        httpStatus.BAD_REQUEST,
        'IntuitAPI#getAllItems | Error while fetching all items',
        qbItems.Fault?.Error,
      )
    }

    return qbItems.Item
  }

  async _invoiceSparseUpdate(payload: QBInvoiceSparseUpdatePayloadType) {
    console.log('IntuitAPI#InvoiceSparseUpdate | invoice sparse update start')
    const url = `${intuitBaseUrl}/v3/company/${this.tokens.intuitRealmId}/invoice?minorversion=${intuitApiMinorVersion}`
    const invoice = await this.postFetchWithHeaders(url, payload)

    if (!invoice)
      throw new APIError(
        httpStatus.BAD_REQUEST,
        'IntuitAPI#InvoiceSparseUpdate | message = no response',
      )

    if (invoice?.Fault) {
      console.error({ Error: invoice.Fault?.Error })
      throw new APIError(
        httpStatus.BAD_REQUEST,
        'IntuitAPI#InvoiceSparseUpdate | Error while sparse update an invoice',
        invoice.Fault?.Error,
      )
    }

    console.log(
      'IntuitAPI#InvoiceSparseUpdate | invoice sparse updated for doc number=',
      invoice.Invoice?.DocNumber,
    )
    return invoice
  }

  async _customerSparseUpdate(payload: QBCustomerSparseUpdatePayloadType) {
    console.log('IntuitAPI#customerSparseUpdate | customer sparse update start')
    const url = `${intuitBaseUrl}/v3/company/${this.tokens.intuitRealmId}/customer?minorversion=${intuitApiMinorVersion}`
    const customer = await this.postFetchWithHeaders(url, payload)

    if (!customer)
      throw new APIError(
        httpStatus.BAD_REQUEST,
        'IntuitAPI#customerSparseUpdate | message = no response',
      )

    if (customer?.Fault) {
      console.error({ Error: customer.Fault?.Error })
      throw new APIError(
        httpStatus.BAD_REQUEST,
        'IntuitAPI#customerSparseUpdate | Error while sparse update a customer',
        customer.Fault?.Error,
      )
    }

    console.log(
      'IntuitAPI#customerSparseUpdate | customer sparse updated with name=',
      customer.Customer?.FullyQualifiedName,
    )
    return customer
  }

  async _itemFullUpdate(payload: QBItemFullUpdatePayloadType) {
    console.info('IntuitAPI#itemFullUpdate | item full update start')
    const url = `${intuitBaseUrl}/v3/company/${this.tokens.intuitRealmId}/item?minorversion=${intuitApiMinorVersion}`
    const item = await this.postFetchWithHeaders(url, payload)

    if (!item)
      throw new APIError(
        httpStatus.BAD_REQUEST,
        'IntuitAPI#itemFullUpdate | message = no response',
      )

    if (item?.Fault) {
      console.error({ Error: item.Fault?.Error })
      throw new APIError(
        httpStatus.BAD_REQUEST,
        'IntuitAPI#itemFullUpdate | Error while item full update',
        item.Fault?.Error,
      )
    }

    console.info(
      'IntuitAPI#itemFullUpdate | item full updated with Id =',
      item.Item?.Id,
    )
    return item
  }

  async _createPayment(payload: QBPaymentCreatePayloadType) {
    console.log('IntuitAPI#createPayment | payment creation start')
    const url = `${intuitBaseUrl}/v3/company/${this.tokens.intuitRealmId}/payment?minorversion=${intuitApiMinorVersion}`
    const payment = await this.postFetchWithHeaders(url, payload)

    if (!payment)
      throw new APIError(
        httpStatus.BAD_REQUEST,
        'IntuitAPI#createPayment | message = no response',
      )

    if (payment?.Fault) {
      console.error({ Error: payment.Fault?.Error })
      throw new APIError(
        httpStatus.BAD_REQUEST,
        'IntuitAPI#createPayment | Error while creating payment',
        payment.Fault?.Error,
      )
    }

    console.log(
      'IntuitAPI#createPayment | payment created with Id =',
      payment.Payment?.Id,
    )
    return payment
  }

  private wrapWithRetry<Args extends unknown[], R>(
    fn: (...args: Args) => Promise<R>,
  ): (...args: Args) => Promise<R> {
    return (...args: Args): Promise<R> => withRetry(fn.bind(this), args)
  }

  customQuery = this.wrapWithRetry(this._customQuery)
  createInvoice = this.wrapWithRetry(this._createInvoice)
  createCustomer = this.wrapWithRetry(this._createCustomer)
  createItem = this.wrapWithRetry(this._createItem)
  getSingleIncomeAccount = this.wrapWithRetry(this._getSingleIncomeAccount)
  getACustomer = this.wrapWithRetry(this._getACustomer)
  getAnItem = this.wrapWithRetry(this._getAnItem)
  getAllItems = this.wrapWithRetry(this._getAllItems)
  invoiceSparseUpdate = this.wrapWithRetry(this._invoiceSparseUpdate)
  customerSparseUpdate = this.wrapWithRetry(this._customerSparseUpdate)
  itemFullUpdate = this.wrapWithRetry(this._itemFullUpdate)
  createPayment = this.wrapWithRetry(this._createPayment)
}
