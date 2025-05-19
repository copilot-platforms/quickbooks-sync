import APIError from '@/app/api/core/exceptions/api'
import { withRetry } from '@/app/api/core/utils/withRetry'
import { intuitApiMinorVersion, intuitBaseUrl } from '@/config'
import { QBTokenSelectSchemaType } from '@/db/schema/qbTokens'
import { getFetcher, postFetcher } from '@/helper/fetch.helper'
import {
  QBCustomerCreatePayloadType,
  QBCustomerParseUpdatePayloadType,
  QBInvoiceCreatePayloadType,
  QBItemCreatePayloadType,
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

  private async manualPostFetch(
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

  private async manualGETFetch(
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
    const res = await this.manualGETFetch(url)

    if (res?.Fault)
      throw new APIError(
        httpStatus.BAD_REQUEST,
        'IntuitAPI#customQuery | message= ' + res?.Fault?.Error?.[0].Detail,
      )
    return res?.QueryResponse
  }

  async _createInvoice(payload: QBInvoiceCreatePayloadType) {
    console.log('IntuitAPI#createInvoice | invoice creation start')
    const url = `${intuitBaseUrl}/v3/company/${this.tokens.intuitRealmId}/invoice?minorversion=${intuitApiMinorVersion}`
    const invoice = await this.manualPostFetch(url, payload)

    if (invoice?.Fault)
      throw new APIError(
        httpStatus.BAD_REQUEST,
        'IntuitAPI#createInvoice | message= ' +
          invoice?.Fault?.Error?.[0].Detail,
      )

    console.log(
      'IntuitAPI#createInvoice | invoice created with doc number=',
      invoice?.Invoice?.DocNumber,
    )
    return invoice
  }

  async _createCustomer(payload: QBCustomerCreatePayloadType) {
    console.log('IntuitAPI#createCustomer | customer creation start')
    const url = `${intuitBaseUrl}/v3/company/${this.tokens.intuitRealmId}/customer?minorversion=${intuitApiMinorVersion}`
    const customer = await this.manualPostFetch(url, payload)

    if (customer?.Fault)
      throw new APIError(
        httpStatus.BAD_REQUEST,
        'IntuitAPI#createCustomer | message= ' +
          customer?.Fault?.Error?.[0].Detail,
      )

    console.log(
      'IntuitAPI#createCustomer | customer created with name=',
      customer?.Customer?.FullyQualifiedName,
    )
    return customer
  }

  async _createItem(payload: QBItemCreatePayloadType) {
    console.log('IntuitAPI#createItem | Item creation start')
    const url = `${intuitBaseUrl}/v3/company/${this.tokens.intuitRealmId}/item?minorversion=${intuitApiMinorVersion}`
    const item = await this.manualPostFetch(url, payload)

    if (item?.Fault)
      throw new APIError(
        httpStatus.BAD_REQUEST,
        'IntuitAPI#createItem | message= ' + item?.Fault?.Error?.[0].Detail,
      )

    console.log('IntuitAPI#createItem | item created with Id =', item?.Item?.Id)
    return item?.Item
  }

  async _getSingleIncomeAccount() {
    const sqlQuery = `SELECT Id FROM Account WHERE AccountType = 'Income' AND AccountSubType = 'SalesOfProductIncome' AND Active = true maxresults 1`
    const qbIncomeAccountRefInfo = await this.customQuery(sqlQuery)
    return qbIncomeAccountRefInfo?.Account?.[0]
  }

  async _getACustomer(givenName: string, familyName: string) {
    const customerQuery = `SELECT Id, SyncToken FROM Customer WHERE GivenName = '${givenName}' AND FamilyName = '${familyName}' AND Active = true`
    const qbCustomers = await this.customQuery(customerQuery)
    return qbCustomers?.Customer?.[0]
  }

  async _getAnItem(name: string) {
    const customerQuery = `select Id, SyncToken from Item where Name = '${name}' maxresults 1`
    const qbItem = await this.customQuery(customerQuery)
    return qbItem?.Item?.[0]
  }

  async _parseUpdateCustomer(payload: QBCustomerParseUpdatePayloadType) {
    console.log('IntuitAPI#parseUpdateCustomer | customer sparse update start')
    const url = `${intuitBaseUrl}/v3/company/${this.tokens.intuitRealmId}/customer?minorversion=${intuitApiMinorVersion}`
    const customer = await this.manualPostFetch(url, payload)

    console.log(
      'IntuitAPI#parseUpdateCustomer | customer sparse updated with name=',
      customer?.Customer?.FullyQualifiedName,
    )
    return customer
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
  parseUpdateCustomer = this.wrapWithRetry(this._parseUpdateCustomer)
}
