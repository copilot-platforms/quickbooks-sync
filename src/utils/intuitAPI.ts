import { withRetry } from '@/app/api/core/utils/withRetry'
import { intuitApiMinorVersion, intuitBaseUrl } from '@/config'
import { QBTokenSelectSchemaType } from '@/db/schema/qbTokens'
import { getFetcher, postFetcher } from '@/helper/fetch.helper'
import {
  QBCustomerCreatePayloadType,
  QBCustomerParseUpdatePayloadType,
  QBInvoiceCreatePayloadType,
  QBInvoiceSparseUpdatePayloadType,
} from '@/type/dto/intuitAPI.dto'

export type IntuitAPITokensType = Pick<
  QBTokenSelectSchemaType,
  'accessToken' | 'refreshToken' | 'intuitRealmId'
>

export default class IntuitAPI {
  private static tokens: IntuitAPITokensType
  private static headers: Record<string, string>

  constructor(tokens: IntuitAPITokensType) {
    IntuitAPI.tokens = tokens
    this.setHeaders()
  }

  private setHeaders() {
    IntuitAPI.headers = {
      Authorization: `Bearer ${IntuitAPI.tokens.accessToken}`,
      Accept: 'application/json',
      'content-type': 'application/json',
    }
  }

  /**
   * This function is used to make a POST request to Intuit API with necessary authorization headers
   *
   * @private
   * @async
   * @param {string} url
   * @param {Record<string, any>} body
   * @param {?Record<string, string>} [customHeaders]
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
   *
   * @private
   * @async
   * @param {string} url
   * @param {?Record<string, string>} [customHeaders]
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
    const url = `${intuitBaseUrl}/v3/company/${IntuitAPI.tokens.intuitRealmId}/query?query=${query}&minorversion=${intuitApiMinorVersion}`
    return await this.getFetchWithHeader(url)
  }

  async _createInvoice(payload: QBInvoiceCreatePayloadType) {
    console.log('IntuitAPI#createInvoice | invoice creation start')
    const url = `${intuitBaseUrl}/v3/company/${IntuitAPI.tokens.intuitRealmId}/invoice?minorversion=${intuitApiMinorVersion}`
    const invoice = await this.postFetchWithHeaders(url, payload)
    console.log(
      'IntuitAPI#createInvoice | invoice created with doc number=',
      invoice?.Invoice?.DocNumber,
    )
    return invoice
  }

  async _createCustomer(payload: QBCustomerCreatePayloadType) {
    console.log('IntuitAPI#createCustomer | customer creation start')
    const url = `${intuitBaseUrl}/v3/company/${IntuitAPI.tokens.intuitRealmId}/customer?minorversion=${intuitApiMinorVersion}`
    const customer = await this.postFetchWithHeaders(url, payload)
    console.log(
      'IntuitAPI#createCustomer | customer created with name=',
      customer?.Customer?.FullyQualifiedName,
    )
    return customer
  }

  async _invoiceSparseUpdate(payload: QBInvoiceSparseUpdatePayloadType) {
    console.log('IntuitAPI#InvoiceSparseUpdate | invoice sparse update start')
    const url = `${intuitBaseUrl}/v3/company/${IntuitAPI.tokens.intuitRealmId}/invoice?minorversion=${intuitApiMinorVersion}`
    const invoice = await this.postFetchWithHeaders(url, payload)
    console.log(
      'IntuitAPI#InvoiceSparseUpdate | invoice sparse updated for doc number=',
      invoice?.Invoice.DocNumber,
    )
    return invoice
  }

  async _sparseUpdateCustomer(payload: QBCustomerParseUpdatePayloadType) {
    console.log('IntuitAPI#sparseUpdateCustomer | customer sparse update start')
    const url = `${intuitBaseUrl}/v3/company/${IntuitAPI.tokens.intuitRealmId}/customer?minorversion=${intuitApiMinorVersion}`
    const customer = await this.postFetchWithHeaders(url, payload)

    console.log(
      'IntuitAPI#sparseUpdateCustomer | customer sparse updated with name=',
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
  invoiceSparseUpdate = this.wrapWithRetry(this._invoiceSparseUpdate)
  sparseUpdateCustomer = this.wrapWithRetry(this._sparseUpdateCustomer)
}
