import APIError from '@/app/api/core/exceptions/api'
import { withRetry } from '@/app/api/core/utils/withRetry'
import { intuitApiMinorVersion, intuitBaseUrl } from '@/config'
import { QBPortalConnectionSelectSchemaType } from '@/db/schema/qbPortalConnections'
import { getFetcher, postFetcher } from '@/helper/fetch.helper'
import {
  QBCustomerCreatePayloadType,
  QBCustomerSparseUpdatePayloadType,
  QBInvoiceCreatePayloadType,
  QBItemCreatePayloadType,
  QBInvoiceSparseUpdatePayloadType,
  QBItemFullUpdatePayloadType,
  QBPaymentCreatePayloadType,
  QBAccountCreatePayloadType,
  QBPurchaseCreatePayloadType,
  QBDeletePayloadType,
  QBDestructiveInvoicePayloadSchema,
} from '@/type/dto/intuitAPI.dto'
import CustomLogger from '@/utils/logger'
import httpStatus from 'http-status'

export type IntuitAPITokensType = Pick<
  QBPortalConnectionSelectSchemaType,
  | 'accessToken'
  | 'refreshToken'
  | 'intuitRealmId'
  | 'incomeAccountRef'
  | 'expenseAccountRef'
  | 'assetAccountRef'
>

export const IntuitAPIErrorMessage = '#IntuitAPIErrorMessage#'

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
    CustomLogger.info({ message: 'IntuitAPI#customQuery' })
    const url = `${intuitBaseUrl}/v3/company/${this.tokens.intuitRealmId}/query?query=${encodeURIComponent(query)}&minorversion=${intuitApiMinorVersion}`
    const res = await this.getFetchWithHeader(url)

    if (!res)
      throw new APIError(
        httpStatus.BAD_REQUEST,
        'IntuitAPI#customQuery | message = no response',
      )

    if (res?.Fault) {
      CustomLogger.error({ obj: res.Fault?.Error, message: 'Error: ' })
      throw new APIError(
        httpStatus.BAD_REQUEST,
        IntuitAPIErrorMessage,
        res.Fault?.Error,
      )
    }
    return res.QueryResponse
  }

  async _createInvoice(payload: QBInvoiceCreatePayloadType) {
    CustomLogger.info({
      obj: { payload },
      message: `IntuitAPI#createInvoice | invoice creation start for realmId: ${this.tokens.intuitRealmId}.`,
    })
    const url = `${intuitBaseUrl}/v3/company/${this.tokens.intuitRealmId}/invoice?minorversion=${intuitApiMinorVersion}`
    const invoice = await this.postFetchWithHeaders(url, payload)

    if (!invoice)
      throw new APIError(
        httpStatus.BAD_REQUEST,
        'IntuitAPI#createInvoice | message = no response',
      )

    if (invoice?.Fault) {
      CustomLogger.error({ obj: invoice.Fault?.Error, message: 'Error: ' })
      throw new APIError(
        httpStatus.BAD_REQUEST,
        IntuitAPIErrorMessage,
        invoice.Fault?.Error,
      )
    }

    CustomLogger.info({
      obj: { response: invoice.Invoice },
      message: `IntuitAPI#createInvoice | invoice created with doc number = ${invoice.Invoice?.DocNumber}.`,
    })
    return invoice
  }

  async _createCustomer(payload: QBCustomerCreatePayloadType) {
    CustomLogger.info({
      obj: { payload },
      message: `IntuitAPI#createCustomer | customer creation start for realmId: ${this.tokens.intuitRealmId}. Payload: `,
    })
    const url = `${intuitBaseUrl}/v3/company/${this.tokens.intuitRealmId}/customer?minorversion=${intuitApiMinorVersion}`
    const customer = await this.postFetchWithHeaders(url, payload)

    if (!customer)
      throw new APIError(
        httpStatus.BAD_REQUEST,
        'IntuitAPI#createCustomer | message = no response',
      )

    if (customer?.Fault) {
      CustomLogger.error({ obj: customer.Fault?.Error, message: 'Error: ' })
      throw new APIError(
        httpStatus.BAD_REQUEST,
        IntuitAPIErrorMessage,
        customer.Fault?.Error,
      )
    }

    CustomLogger.info({
      obj: { response: customer.Customer },
      message: `IntuitAPI#createCustomer | customer created with name = ${customer.Customer?.FullyQualifiedName}.`,
    })
    return customer
  }

  async _createItem(payload: QBItemCreatePayloadType) {
    CustomLogger.info({
      obj: { payload },
      message: `IntuitAPI#createItem | Item creation start for realmId: ${this.tokens.intuitRealmId}. Payload: `,
    })
    const url = `${intuitBaseUrl}/v3/company/${this.tokens.intuitRealmId}/item?minorversion=${intuitApiMinorVersion}`
    const item = await this.postFetchWithHeaders(url, payload)

    if (!item)
      throw new APIError(
        httpStatus.BAD_REQUEST,
        'IntuitAPI#createItem | message = no response',
      )

    if (item?.Fault) {
      CustomLogger.error({ obj: item.Fault?.Error, message: 'Error: ' })
      throw new APIError(
        httpStatus.BAD_REQUEST,
        IntuitAPIErrorMessage,
        item.Fault?.Error,
      )
    }

    CustomLogger.info({
      obj: { response: item.Item },
      message: `IntuitAPI#createItem | item created with Id = ${item?.Item?.Id}. Response: `,
    })
    return item.Item
  }

  async _getSingleIncomeAccount() {
    CustomLogger.info({
      message: `IntuitAPI#getSingleIncomeAccount | Income account query start for realmId: ${this.tokens.intuitRealmId}`,
    })
    const sqlQuery = `SELECT Id FROM Account WHERE AccountType = 'Income' AND AccountSubType = 'SalesOfProductIncome' AND Active = true maxresults 1`
    const qbIncomeAccountRefInfo = await this.customQuery(sqlQuery)

    if (!qbIncomeAccountRefInfo)
      throw new APIError(
        httpStatus.BAD_REQUEST,
        'IntuitAPI#getSingleIncomeAccount | message = no response',
      )

    if (qbIncomeAccountRefInfo?.Fault) {
      CustomLogger.error({
        obj: qbIncomeAccountRefInfo.Fault?.Error,
        message: 'Error: ',
      })
      throw new APIError(
        httpStatus.BAD_REQUEST,
        IntuitAPIErrorMessage,
        qbIncomeAccountRefInfo.Fault?.Error,
      )
    }

    return qbIncomeAccountRefInfo.Account?.[0]
  }

  async _getACustomer(displayName: string) {
    CustomLogger.info({
      message: `IntuitAPI#getACustomer | Customer query start for realmId: ${this.tokens.intuitRealmId}. Name: ${displayName}`,
    })
    const customerQuery = `SELECT Id, SyncToken FROM Customer WHERE DisplayName = '${displayName}' AND Active = true`
    const qbCustomers = await this.customQuery(customerQuery)

    if (!qbCustomers)
      throw new APIError(
        httpStatus.BAD_REQUEST,
        'IntuitAPI#getACustomer | message = no response',
      )

    if (qbCustomers?.Fault) {
      CustomLogger.error({ obj: qbCustomers.Fault?.Error, message: 'Error: ' })
      throw new APIError(
        httpStatus.BAD_REQUEST,
        IntuitAPIErrorMessage,
        qbCustomers.Fault?.Error,
      )
    }

    return qbCustomers.Customer?.[0]
  }

  async _getAnItem(name: string) {
    CustomLogger.info({
      message: `IntuitAPI#getAnItem | Item query start for realmId: ${this.tokens.intuitRealmId}. Name: ${name}`,
    })
    const customerQuery = `select Id, SyncToken from Item where Name = '${name}' maxresults 1`
    const qbItem = await this.customQuery(customerQuery)

    if (!qbItem)
      throw new APIError(
        httpStatus.BAD_REQUEST,
        'IntuitAPI#getAnItem | message = no response',
      )

    if (qbItem?.Fault) {
      CustomLogger.error({ obj: qbItem.Fault?.Error, message: 'Error: ' })
      throw new APIError(
        httpStatus.BAD_REQUEST,
        IntuitAPIErrorMessage,
        qbItem.Fault?.Error,
      )
    }

    return qbItem.Item?.[0]
  }

  async _getAllItems(limit: number, columns: string[] = ['Id']) {
    CustomLogger.info({
      message: `IntuitAPI#getAllItems | Item query start for realmId: ${this.tokens.intuitRealmId}`,
    })
    const stringColumns = columns.map((column) => `${column}`).join(',')
    const customerQuery = `select ${stringColumns} from Item where Type IN ('Group', 'Service', 'Inventory', 'NonInventory') maxresults ${limit}` // Other items with type "Category" cannot be used in invoice line item. It throws an error.
    CustomLogger.info({
      obj: { customerQuery },
      message: 'IntuitAPI#getAllItems',
    })
    const qbItems = await this.customQuery(customerQuery)

    if (!qbItems)
      throw new APIError(
        httpStatus.BAD_REQUEST,
        'IntuitAPI#getAllItems | message = no response',
      )

    if (qbItems?.Fault) {
      CustomLogger.error({ obj: qbItems.Fault?.Error, message: 'Error: ' })
      throw new APIError(
        httpStatus.BAD_REQUEST,
        IntuitAPIErrorMessage,
        qbItems.Fault?.Error,
      )
    }

    return qbItems.Item
  }

  async _invoiceSparseUpdate(payload: QBInvoiceSparseUpdatePayloadType) {
    CustomLogger.info({
      obj: { payload },
      message: `IntuitAPI#InvoiceSparseUpdate | invoice sparse update start for realmId: ${this.tokens.intuitRealmId}. `,
    })
    const url = `${intuitBaseUrl}/v3/company/${this.tokens.intuitRealmId}/invoice?minorversion=${intuitApiMinorVersion}`
    const invoice = await this.postFetchWithHeaders(url, payload)

    if (!invoice)
      throw new APIError(
        httpStatus.BAD_REQUEST,
        'IntuitAPI#InvoiceSparseUpdate | message = no response',
      )

    if (invoice?.Fault) {
      CustomLogger.error({ obj: invoice.Fault?.Error, message: 'Error: ' })
      throw new APIError(
        httpStatus.BAD_REQUEST,
        IntuitAPIErrorMessage,
        invoice.Fault?.Error,
      )
    }

    CustomLogger.info({
      obj: { response: invoice.Invoice },
      message: `IntuitAPI#InvoiceSparseUpdate | invoice sparse updated for doc number = ${invoice.Invoice?.DocNumber}.`,
    })
    return invoice
  }

  async _customerSparseUpdate(payload: QBCustomerSparseUpdatePayloadType) {
    CustomLogger.info({
      obj: { payload },
      message: `IntuitAPI#customerSparseUpdate | customer sparse update start for realmId: ${this.tokens.intuitRealmId}. `,
    })
    const url = `${intuitBaseUrl}/v3/company/${this.tokens.intuitRealmId}/customer?minorversion=${intuitApiMinorVersion}`
    const customer = await this.postFetchWithHeaders(url, payload)

    if (!customer)
      throw new APIError(
        httpStatus.BAD_REQUEST,
        'IntuitAPI#customerSparseUpdate | message = no response',
      )

    if (customer?.Fault) {
      CustomLogger.error({ obj: customer.Fault?.Error, message: 'Error: ' })
      throw new APIError(
        httpStatus.BAD_REQUEST,
        IntuitAPIErrorMessage,
        customer.Fault?.Error,
      )
    }

    CustomLogger.info({
      obj: { response: customer.Customer },
      message: `IntuitAPI#customerSparseUpdate | customer sparse updated with name = ${customer.Customer?.FullyQualifiedName}. `,
    })
    return customer
  }

  async _itemFullUpdate(payload: QBItemFullUpdatePayloadType) {
    CustomLogger.info({
      obj: { payload },
      message: `IntuitAPI#itemFullUpdate | item full update start for realmId: ${this.tokens.intuitRealmId}. `,
    })
    const url = `${intuitBaseUrl}/v3/company/${this.tokens.intuitRealmId}/item?minorversion=${intuitApiMinorVersion}`
    const item = await this.postFetchWithHeaders(url, payload)

    if (!item)
      throw new APIError(
        httpStatus.BAD_REQUEST,
        'IntuitAPI#itemFullUpdate | message = no response',
      )

    if (item?.Fault) {
      CustomLogger.error({ obj: item.Fault?.Error, message: 'Error: ' })
      throw new APIError(
        httpStatus.BAD_REQUEST,
        IntuitAPIErrorMessage,
        item.Fault?.Error,
      )
    }

    CustomLogger.info({
      obj: { response: item.Item },
      message: `IntuitAPI#itemFullUpdate | item full updated with Id = ${item.Item?.Id}.`,
    })
    return item
  }

  async _createPayment(payload: QBPaymentCreatePayloadType) {
    CustomLogger.info({
      obj: { payload },
      message: `IntuitAPI#createPayment | payment creation start for realmId: ${this.tokens.intuitRealmId}. `,
    })
    const url = `${intuitBaseUrl}/v3/company/${this.tokens.intuitRealmId}/payment?minorversion=${intuitApiMinorVersion}`
    const payment = await this.postFetchWithHeaders(url, payload)

    if (!payment)
      throw new APIError(
        httpStatus.BAD_REQUEST,
        'IntuitAPI#createPayment | message = no response',
      )

    if (payment?.Fault) {
      CustomLogger.error({ obj: payment.Fault?.Error, message: 'Error: ' })
      throw new APIError(
        httpStatus.BAD_REQUEST,
        IntuitAPIErrorMessage,
        payment.Fault?.Error,
      )
    }

    CustomLogger.info({
      obj: { response: payment.Payment },
      message: `IntuitAPI#createPayment | payment created with Id = ${payment.Payment?.Id}.`,
    })
    return payment
  }

  async _voidInvoice(payload: QBDestructiveInvoicePayloadSchema) {
    CustomLogger.info({
      obj: { payload },
      message: `IntuitAPI#voidInvoice | invoice void start for realmId: ${this.tokens.intuitRealmId}. `,
    })
    const url = `${intuitBaseUrl}/v3/company/${this.tokens.intuitRealmId}/invoice?operation=void&minorversion=${intuitApiMinorVersion}`
    const invoice = await this.postFetchWithHeaders(url, payload)

    if (!invoice)
      throw new APIError(
        httpStatus.BAD_REQUEST,
        'IntuitAPI#voidInvoice | message = no response',
      )

    if (invoice?.Fault) {
      CustomLogger.error({ obj: invoice.Fault?.Error, message: 'Error: ' })
      throw new APIError(
        httpStatus.BAD_REQUEST,
        IntuitAPIErrorMessage,
        invoice.Fault?.Error,
      )
    }

    CustomLogger.info({
      obj: { response: invoice.Invoice },
      message: `IntuitAPI#voidInvoice | Voided invoice with Id = ${invoice.Invoice?.Id}.`,
    })
    return invoice
  }

  async _deleteInvoice(payload: QBDestructiveInvoicePayloadSchema) {
    CustomLogger.info({
      obj: { payload },
      message: `IntuitAPI#deleteInvoice | invoice deletion start for realmId: ${this.tokens.intuitRealmId}. `,
    })
    const url = `${intuitBaseUrl}/v3/company/${this.tokens.intuitRealmId}/invoice?operation=delete&minorversion=${intuitApiMinorVersion}`
    const invoice = await this.postFetchWithHeaders(url, payload)

    if (!invoice) {
      throw new APIError(
        httpStatus.BAD_REQUEST,
        'IntuitAPI#deleteInvoice | No invoice deletion confirmation was received from Quickbooks API',
      )
    }

    if (invoice.Fault) {
      CustomLogger.error({ obj: invoice.Fault.Error, message: 'Error: ' })
      throw new APIError(
        httpStatus.BAD_REQUEST,
        IntuitAPIErrorMessage,
        invoice.Fault?.Error,
      )
    }

    CustomLogger.info({
      obj: { response: invoice.Invoice },
      message: `IntuitAPI#deleteInvoice | Deleted invoice with id = ${invoice.Invoice?.Id}. `,
    })
    return invoice
  }

  async _deletePayment(payload: QBDeletePayloadType) {
    CustomLogger.info({
      obj: { payload },
      message: `IntuitAPI#deletePayment | payment delete start for realmId: ${this.tokens.intuitRealmId}. `,
    })
    const url = `${intuitBaseUrl}/v3/company/${this.tokens.intuitRealmId}/payment?operation=delete&minorversion=${intuitApiMinorVersion}`
    const payment = await this.postFetchWithHeaders(url, payload)

    if (!payment)
      throw new APIError(
        httpStatus.BAD_REQUEST,
        'IntuitAPI#deletePayment | message = no response',
      )

    if (payment?.Fault) {
      CustomLogger.error({ obj: payment.Fault?.Error, message: 'Error: ' })
      throw new APIError(
        httpStatus.BAD_REQUEST,
        IntuitAPIErrorMessage,
        payment.Fault?.Error,
      )
    }

    CustomLogger.info({
      obj: { response: payment.Payment },
      message: `IntuitAPI#deletePayment | payment deleted with Id = ${payment.Payment?.Id}. `,
    })
    return payment
  }

  async _getAnAccountByName(accountName: string) {
    CustomLogger.info({
      obj: { realmId: this.tokens.intuitRealmId },
      message:
        'IntuitAPI#getAnAccountByName | Account query start for realmId: ',
    })
    const query = `SELECT Id FROM Account where Name = '${accountName}' AND Active = true`
    const customQuery = await this.customQuery(query)

    if (!customQuery)
      throw new APIError(
        httpStatus.BAD_REQUEST,
        'IntuitAPI#getAnAccountByName | message = no response',
      )

    if (customQuery?.Fault) {
      CustomLogger.error({ obj: customQuery.Fault?.Error, message: 'Error: ' })
      throw new APIError(
        httpStatus.BAD_REQUEST,
        IntuitAPIErrorMessage,
        customQuery.Fault?.Error,
      )
    }

    return customQuery.Account?.[0]
  }

  async _createAccount(payload: QBAccountCreatePayloadType) {
    CustomLogger.info({
      obj: { payload },
      message: `IntuitAPI#createAssetAccount | Account create start for realmId: ${this.tokens.intuitRealmId}. `,
    })
    const url = `${intuitBaseUrl}/v3/company/${this.tokens.intuitRealmId}/account?minorversion=${intuitApiMinorVersion}`
    const account = await this.postFetchWithHeaders(url, payload)

    if (!account)
      throw new APIError(
        httpStatus.BAD_REQUEST,
        'IntuitAPI#createAssetAccount | message = no response',
      )

    if (account?.Fault) {
      CustomLogger.error({ obj: account.Fault?.Error, message: 'Error: ' })
      throw new APIError(
        httpStatus.BAD_REQUEST,
        IntuitAPIErrorMessage,
        account.Fault?.Error,
      )
    }

    CustomLogger.info({
      obj: { response: account.Account },
      message: `IntuitAPI#createAssetAccount | Account created with Id = ${account.Account?.Id}. `,
    })
    return account.Account
  }

  async _createPurchase(payload: QBPurchaseCreatePayloadType) {
    CustomLogger.info({
      obj: { payload },
      message: `IntuitAPI#createPurchase | Purchase create start for realmId: ${this.tokens.intuitRealmId}.`,
    })
    const url = `${intuitBaseUrl}/v3/company/${this.tokens.intuitRealmId}/purchase?minorversion=${intuitApiMinorVersion}`
    const purchase = await this.postFetchWithHeaders(url, payload)

    if (!purchase)
      throw new APIError(
        httpStatus.BAD_REQUEST,
        'IntuitAPI#createPurchase | message = no response',
      )

    if (purchase?.Fault) {
      CustomLogger.error({ obj: purchase.Fault?.Error, message: 'Error: ' })
      throw new APIError(
        httpStatus.BAD_REQUEST,
        IntuitAPIErrorMessage,
        purchase.Fault?.Error,
      )
    }

    CustomLogger.info({
      obj: { response: purchase.Purchase },
      message: `IntuitAPI#createPurchase | Purchase created with Id = ${purchase.Purchase?.Id}.`,
    })
    return purchase
  }

  async _deletePurchase(payload: QBDeletePayloadType) {
    CustomLogger.info({
      obj: { payload },
      message: `IntuitAPI#deletePurchase | purchase delete start for realmId: ${this.tokens.intuitRealmId}.`,
    })
    const url = `${intuitBaseUrl}/v3/company/${this.tokens.intuitRealmId}/purchase?operation=delete&minorversion=${intuitApiMinorVersion}`
    const purchase = await this.postFetchWithHeaders(url, payload)

    if (!purchase)
      throw new APIError(
        httpStatus.BAD_REQUEST,
        'IntuitAPI#deletePurchase | message = no response',
      )

    if (purchase?.Fault) {
      CustomLogger.error({ obj: purchase.Fault?.Error, message: 'Error: ' })
      throw new APIError(
        httpStatus.BAD_REQUEST,
        IntuitAPIErrorMessage,
        purchase.Fault?.Error,
      )
    }

    CustomLogger.info({
      obj: { response: purchase.Purchase },
      message: `IntuitAPI#deletePurchase | purchase deleted with Id = ${purchase.Purchase?.Id}. `,
    })
    return purchase
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
  voidInvoice = this.wrapWithRetry(this._voidInvoice)
  deleteInvoice = this.wrapWithRetry(this._deleteInvoice)
  getAnAccountByName = this.wrapWithRetry(this._getAnAccountByName)
  createAccount = this.wrapWithRetry(this._createAccount)
  createPurchase = this.wrapWithRetry(this._createPurchase)
  deletePayment = this.wrapWithRetry(this._deletePayment)
  deletePurchase = this.wrapWithRetry(this._deletePurchase)
}
