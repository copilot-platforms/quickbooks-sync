import { withRetry } from '@/app/api/core/utils/withRetry'
import { intuitApiMinorVersion, intuitBaseUrl } from '@/config'
import { QBTokenSelectSchemaType } from '@/db/schema/qbTokens'
import { getFetcher, postFetcher } from '@/helper/fetch.helper'
import { QBInvoiceCreatePayloadType } from '@/type/dto/intuitAPI.dto'

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
    const url = `${intuitBaseUrl}/v3/company/${IntuitAPI.tokens.intuitRealmId}/query?query=${query}&minorversion=${intuitApiMinorVersion}`
    return await this.manualGETFetch(url)
  }

  async _createInvoice(payload: QBInvoiceCreatePayloadType) {
    const url = `${intuitBaseUrl}/v3/company/${IntuitAPI.tokens.intuitRealmId}/invoice?minorversion=${intuitApiMinorVersion}`
    return await this.manualPostFetch(url, payload)
  }

  private wrapWithRetry<Args extends unknown[], R>(
    fn: (...args: Args) => Promise<R>,
  ): (...args: Args) => Promise<R> {
    return (...args: Args): Promise<R> => withRetry(fn.bind(this), args)
  }

  customQuery = this.wrapWithRetry(this._customQuery)
  createInvoice = this.wrapWithRetry(this._createInvoice)
}
