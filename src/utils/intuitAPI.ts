import APIError from '@/app/api/core/exceptions/api'
import { RetryOptions, withRetry } from '@/app/api/core/utils/withRetry'
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
  QBDepositCreatePayloadType,
  QBDepositResponseSchema,
  QBDepositResponseType,
  QBDepositQueryResponseSchema,
  QBDeletePayloadType,
  QBDestructiveInvoicePayloadSchema,
  QBItemRowType,
  QBItemQueryResponseSchema,
  QBItemResponseType,
  QBItemResponseSchema,
  QBAccountUpdatePayloadType,
  QBAccountRowType,
  QBAccountQueryResponseSchema,
  QBAccountResponseType,
  QBAccountResponseSchema,
  CompanyInfoType,
  CompanyInfoSchema,
  CustomerQueryResponseType,
  QBCustomerResponseSchema,
  QBItemsResponseSchema,
  QBItemsResponseType,
  QBInvoiceResponseType,
  QBInvoiceResponseSchema,
  QBInvoiceDeleteResponseType,
  QBInvoiceDeleteResponseSchema,
  QBPaymentResponseType,
  QBPaymentResponseSchema,
  QBPaymentDeleteResponseType,
  QBPaymentDeleteResponseSchema,
  QBPurchaseResponseType,
  QBPurchaseResponseSchema,
  QBPurchaseDeleteResponseType,
  QBPurchaseDeleteResponseSchema,
  SingleIdAndTokenResponseSchema,
  SingleIdAndTokenResponseType,
  QBInvoiceQueryResponseSchema,
  QBInvoiceRowType,
  CustomerListEnvelopeSchema,
  QBFaultSchema,
} from '@/type/dto/intuitAPI.dto'
import { escapeForQBQuery, getNameAsCustomer } from '@/utils/string'
import CustomLogger from '@/utils/logger'
import httpStatus from 'http-status'
import { z } from 'zod'

export type IntuitAPITokensType = Pick<
  QBPortalConnectionSelectSchemaType,
  | 'accessToken'
  | 'refreshToken'
  | 'intuitRealmId'
  | 'incomeAccountRef'
  | 'expenseAccountRef'
  | 'assetAccountRef'
  | 'serviceItemRef'
  | 'clientFeeRef'
  | 'bankAccountRef'
> & { isSuspended?: boolean }

export const IntuitAPIErrorMessage = '#IntuitAPIErrorMessage#'

// APIError.status carries the QBO fault code (e.g. 6140) when available,
// else BAD_REQUEST. withErrorHandler clamps non-HTTP codes downstream.
export function assertNotQBFault(raw: unknown, opName: string): void {
  const result = QBFaultSchema.safeParse(raw)
  if (!result.success) return
  const errors = result.data.Fault.Error
  CustomLogger.error({ obj: errors, message: 'Error: ' })
  const firstCode = errors[0]?.code
  const code =
    typeof firstCode === 'number' ? firstCode : httpStatus.BAD_REQUEST
  throw new APIError(code, `${IntuitAPIErrorMessage}${opName}`, errors)
}

// SELECT projection for each read entity. `satisfies` binds the constant to
// the row schema's keys — a typo or stale field name fails tsc. Keep in
// sync with the row schemas in src/type/dto/intuitAPI.dto.ts.
export const QB_INVOICE_COLUMNS = [
  'Id',
  'SyncToken',
  'DocNumber',
  'Balance',
  'TotalAmt',
  'TxnDate',
  'DueDate',
  'PrivateNote',
  'CustomerRef',
] as const satisfies ReadonlyArray<keyof QBInvoiceRowType>

export const QB_ITEM_COLUMNS = [
  'Id',
  'SyncToken',
  'Name',
  'ClassRef',
  'Active',
  'UnitPrice',
  'Description',
] as const satisfies ReadonlyArray<keyof QBItemRowType>

export const QB_CUSTOMER_COLUMNS = [
  'Id',
  'SyncToken',
  'Active',
  'CompanyName',
  'FullyQualifiedName',
  'PrimaryEmailAddr',
] as const satisfies ReadonlyArray<keyof CustomerQueryResponseType>

export const QB_ACCOUNT_COLUMNS = [
  'Id',
  'Name',
  'SyncToken',
  'Active',
  'AccountType',
] as const satisfies ReadonlyArray<keyof QBAccountRowType>

type GetACustomerOverloads = {
  (
    displayName: string,
    id?: undefined,
    includeInactive?: boolean,
  ): Promise<CustomerQueryResponseType>
  (
    displayName: undefined,
    id: string,
    includeInactive?: boolean,
  ): Promise<CustomerQueryResponseType>
  (
    displayName: string,
    id: string,
    includeInactive?: boolean,
  ): Promise<CustomerQueryResponseType>
}

type GetAnItemOverloads = {
  (
    name: string,
    id?: undefined,
    includeInactive?: boolean,
  ): Promise<QBItemRowType>
  (
    name: undefined,
    id: string,
    includeInactive?: boolean,
  ): Promise<QBItemRowType>
  (name: string, id: string, includeInactive?: boolean): Promise<QBItemRowType>
}

type GetAnAccountOverloads = {
  (
    accountName: string,
    id?: undefined,
    includeInactive?: boolean,
  ): Promise<QBAccountRowType>
  (
    accountName: undefined,
    id: string,
    includeInactive?: boolean,
  ): Promise<QBAccountRowType>
  (
    accountName: string,
    id: string,
    includeInactive?: boolean,
  ): Promise<QBAccountRowType>
}

// Upper bound on the " (Customer) N" suffix counter when resolving a unique
// DisplayName. If exceeded, creation is aborted and a human is paged — having
// 20+ Copilot clients sharing a single display name is pathological.
const CUSTOMER_NAME_MAX_CANDIDATES = 20

export default class IntuitAPI {
  tokens: IntuitAPITokensType
  private headers: Record<string, string>

  constructor(tokens: IntuitAPITokensType) {
    this.tokens = tokens
    this.headers = {
      Authorization: `Bearer ${this.tokens.accessToken}`,
      Accept: 'application/json',
      'content-type': 'application/json',
    }
  }

  private getNameWithDeleted(name: string) {
    return `${name} (deleted)`
  }

  /**
   * This function is used to make a POST request to Intuit API with necessary authorization headers
   */
  private async postFetchWithHeaders(
    url: string,
    body: Record<string, unknown>,
    customHeaders?: Record<string, string>,
  ): Promise<unknown> {
    const headers = {
      ...this.headers,
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
  ): Promise<unknown> {
    const headers = {
      ...this.headers,
      ...customHeaders,
    }
    const response = await getFetcher(url, headers)
    return response
  }

  async _customQuery(query: string): Promise<unknown> {
    CustomLogger.info({ message: 'IntuitAPI#customQuery', obj: { query } })
    const url = `${intuitBaseUrl}/v3/company/${this.tokens.intuitRealmId}/query?query=${encodeURIComponent(query)}&minorversion=${intuitApiMinorVersion}`
    const res = await this.getFetchWithHeader(url)

    if (!res)
      throw new APIError(
        httpStatus.BAD_REQUEST,
        'IntuitAPI#customQuery | message = no response',
      )

    assertNotQBFault(res, 'customQuery')
    return (res as { QueryResponse?: unknown }).QueryResponse
  }

  async _createInvoice(
    payload: QBInvoiceCreatePayloadType,
  ): Promise<QBInvoiceResponseType> {
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

    assertNotQBFault(invoice, 'createInvoice')

    const parsed = QBInvoiceResponseSchema.parse(invoice)
    CustomLogger.info({
      obj: { response: parsed.Invoice },
      message: `IntuitAPI#createInvoice | invoice created with doc number = ${parsed.Invoice?.DocNumber ?? ''}.`,
    })
    return parsed
  }

  async _createCustomer(
    payload: QBCustomerCreatePayloadType,
  ): Promise<CustomerQueryResponseType> {
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

    assertNotQBFault(customer, 'createCustomer')

    const parsed = QBCustomerResponseSchema.parse(customer)
    CustomLogger.info({
      obj: { response: parsed.Customer },
      message: `IntuitAPI#createCustomer | customer created with name = ${parsed.Customer.FullyQualifiedName ?? ''}.`,
    })
    return parsed.Customer
  }

  async _createItem(payload: QBItemCreatePayloadType): Promise<QBItemRowType> {
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

    assertNotQBFault(item, 'createItem')

    const parsed = QBItemResponseSchema.parse(item)
    CustomLogger.info({
      obj: { response: parsed.Item },
      message: `IntuitAPI#createItem | item created with Id = ${parsed.Item?.Id}. Response: `,
    })
    return parsed.Item
  }

  async _getSingleIncomeAccount(): Promise<QBAccountRowType | undefined> {
    CustomLogger.info({
      message: `IntuitAPI#getSingleIncomeAccount | Income account query start for realmId: ${this.tokens.intuitRealmId}`,
    })
    const sqlQuery = `select ${QB_ACCOUNT_COLUMNS.join(', ')} from Account where AccountType = 'Income' AND AccountSubType = 'SalesOfProductIncome' AND Active = true maxresults 1`
    const qbIncomeAccountRefInfo = await this.customQuery(sqlQuery)

    if (!qbIncomeAccountRefInfo)
      throw new APIError(
        httpStatus.BAD_REQUEST,
        'IntuitAPI#getSingleIncomeAccount | Income account not found',
      )

    const parsed = QBAccountQueryResponseSchema.parse(qbIncomeAccountRefInfo)
    return parsed.Account?.[0]
  }

  async _getAccountsForProductMapping(): Promise<{
    income: QBAccountRowType[]
    expense: QBAccountRowType[]
    asset: QBAccountRowType[]
  }> {
    CustomLogger.info({
      message: `IntuitAPI#getAccountsForProductMapping | start for realmId: ${this.tokens.intuitRealmId}`,
    })
    // QBO's query parser does not support OR, parentheses for grouping, or
    // IN on AccountType — one flat query per AccountType is the only shape
    // that parses.
    const baseCols = QB_ACCOUNT_COLUMNS.join(', ')
    const incomeQuery = `SELECT ${baseCols}, AccountSubType FROM Account WHERE AccountType = 'Income' AND AccountSubType = 'SalesOfProductIncome' AND Active = true`
    const expenseQuery = `SELECT ${baseCols} FROM Account WHERE AccountType = 'Expense' AND Active = true`
    const assetQuery = `SELECT ${baseCols} FROM Account WHERE AccountType = 'Bank' AND Active = true`

    const [incomeRaw, expenseRaw, assetRaw] = await Promise.all([
      this.customQuery(incomeQuery),
      this.customQuery(expenseQuery),
      this.customQuery(assetQuery),
    ])

    // customQuery returns undefined when QBO responds with no QueryResponse
    // key (degenerate but observed in some empty-realm states). Treat as an
    // empty bucket rather than a hard error — the UI shows "No matching
    // accounts in QuickBooks" instead of a misleading "Could not load."
    const parse = (raw: unknown): QBAccountRowType[] => {
      if (raw === undefined || raw === null) return []
      const parsed = QBAccountQueryResponseSchema.parse(raw)
      return parsed.Account ?? []
    }

    return {
      income: parse(incomeRaw),
      expense: parse(expenseRaw),
      asset: parse(assetRaw),
    }
  }

  /**
   * Either displayName or id must be provided
   */
  async _getACustomer(
    displayName: string,
    id?: undefined,
    includeInactive?: boolean,
  ): Promise<CustomerQueryResponseType>
  async _getACustomer(
    displayName: undefined,
    id: string,
    includeInactive?: boolean,
  ): Promise<CustomerQueryResponseType>
  async _getACustomer(
    displayName: string,
    id: string,
    includeInactive?: boolean,
  ): Promise<CustomerQueryResponseType>
  async _getACustomer(
    displayName?: string,
    id?: string,
    includeInactive?: boolean,
  ) {
    if (!displayName && !id) {
      throw new APIError(
        httpStatus.BAD_REQUEST,
        'IntuitAPI#getACustomer | At least one of display name or id must be provided',
      )
    }

    const sanitizedDisplayName =
      displayName && escapeForQBQuery(displayName.trim())
    let queryCondition = sanitizedDisplayName
      ? `DisplayName IN ('${sanitizedDisplayName}', '${this.getNameWithDeleted(sanitizedDisplayName)}')`
      : `Id = '${id}'`

    queryCondition = `${queryCondition} AND Active IN (true${includeInactive ? ', false' : ''})` // By default, QB returns only active customers.

    CustomLogger.info({
      message: `IntuitAPI#getACustomer | Customer query start for realmId: ${this.tokens.intuitRealmId}. Name: ${displayName}, Id: ${id}`,
    })
    const customerQuery = `select ${QB_CUSTOMER_COLUMNS.join(', ')} from Customer where ${queryCondition}`
    const qbCustomers = await this.customQuery(customerQuery)

    if (!qbCustomers) return null

    const envelope = CustomerListEnvelopeSchema.parse(qbCustomers)
    if (!envelope.Customer) return
    return envelope.Customer[0]
  }

  // QBO's parser mishandles special chars on PrimaryEmailAddr filters, so we
  // page and match client-side. sanitizedCompanyName disambiguates the same
  // email across companies; normalisation matches customer.service.ts.
  // ORDERBY Id ASC pins a stable cursor — QBO's default (LastUpdatedTime DESC)
  // lets a mid-walk update shift a row past STARTPOSITION (false negative).
  async _getCustomerByEmail(
    email: string,
    sanitizedCompanyName?: string,
  ): Promise<CustomerQueryResponseType | undefined> {
    const needle = email.trim().toLowerCase()
    if (!needle) return

    CustomLogger.info({
      obj: { email, sanitizedCompanyName },
      message: `IntuitAPI#getCustomerByEmail | Customer query start for realmId: ${this.tokens.intuitRealmId}. Email: ${email}`,
    })

    const pageSize = 1000
    let startPosition = 1

    while (true) {
      const customerQuery = `select ${QB_CUSTOMER_COLUMNS.join(', ')} from Customer where Active IN (true, false) ORDERBY Id ASC STARTPOSITION ${startPosition} MAXRESULTS ${pageSize}`
      const qbCustomers = await this.customQuery(customerQuery)
      const envelope = CustomerListEnvelopeSchema.parse(qbCustomers ?? {})
      const customers = envelope.Customer ?? []
      if (customers.length === 0) return

      const match = customers.find((c) => {
        const addr = c.PrimaryEmailAddr?.Address
        if (typeof addr !== 'string') return false
        if (addr.trim().toLowerCase() !== needle) return false
        if ((c.CompanyName || undefined) !== sanitizedCompanyName) return false
        return true
      })
      if (match) return match

      if (customers.length < pageSize) return
      startPosition += pageSize
    }
  }

  /**
   * Resolves a DisplayName that is free across Customer, Vendor, and Employee
   * (QBO enforces uniqueness across all three). Tries the baseName first, then
   * "baseName (Customer)", "baseName (Customer) 2", ..., up to
   * CUSTOMER_NAME_MAX_CANDIDATES. Queries all three entities in parallel with
   * DisplayName IN (...) and picks the first candidate not in the returned set.
   *
   * Inactive records are intentionally excluded: QBO auto-suffixes their
   * DisplayName with " (deleted)" when deactivated, freeing the original name.
   *
   * Intentionally NOT wrapped in wrapWithRetry — each of the three inner
   * customQuery calls is already retried by withRetry (up to 5 attempts on
   * 429/5xx/transient network). Re-wrapping would amplify rate-limit bursts
   * (worst case 5 × 3 × 5 = 75 requests) and make recovery worse.
   *
   * Throws if every candidate is taken.
   */
  async resolveUniqueCustomerName(baseName: string): Promise<string> {
    const suffixed = getNameAsCustomer(baseName)
    const candidates = [baseName, suffixed]
    for (let i = 2; i <= CUSTOMER_NAME_MAX_CANDIDATES; i++) {
      candidates.push(`${suffixed} ${i}`)
    }

    const escapedList = candidates
      .map((c) => `'${escapeForQBQuery(c)}'`)
      .join(', ')

    CustomLogger.info({
      message: `IntuitAPI#resolveUniqueCustomerName | Resolving unique DisplayName for realmId: ${this.tokens.intuitRealmId}. Base: "${baseName}"`,
    })

    const [customerRes, vendorRes, employeeRes] = await Promise.all([
      this.customQuery(
        `SELECT DisplayName FROM Customer WHERE DisplayName IN (${escapedList})`,
      ),
      this.customQuery(
        `SELECT DisplayName FROM Vendor WHERE DisplayName IN (${escapedList})`,
      ),
      this.customQuery(
        `SELECT DisplayName FROM Employee WHERE DisplayName IN (${escapedList})`,
      ),
    ])

    // Case-insensitive comparison: QBO's DisplayName equality is case-
    // insensitive, so a returned record may differ in case from our candidate.
    const usedNames = new Set<string>()
    const customerNameEnv = z
      .object({
        Customer: z.array(z.object({ DisplayName: z.string() })).optional(),
      })
      .parse(customerRes ?? {})
    for (const c of customerNameEnv.Customer ?? []) {
      usedNames.add(c.DisplayName.toLowerCase())
    }

    const vendorNameEnv = z
      .object({
        Vendor: z.array(z.object({ DisplayName: z.string() })).optional(),
      })
      .parse(vendorRes ?? {})
    for (const v of vendorNameEnv.Vendor ?? []) {
      usedNames.add(v.DisplayName.toLowerCase())
    }

    const employeeNameEnv = z
      .object({
        Employee: z.array(z.object({ DisplayName: z.string() })).optional(),
      })
      .parse(employeeRes ?? {})
    for (const e of employeeNameEnv.Employee ?? []) {
      usedNames.add(e.DisplayName.toLowerCase())
    }

    const freeName = candidates.find((c) => !usedNames.has(c.toLowerCase()))
    if (!freeName) {
      throw new APIError(
        httpStatus.CONFLICT,
        `${IntuitAPIErrorMessage}resolveUniqueCustomerName | All ${CUSTOMER_NAME_MAX_CANDIDATES} candidate names are taken for base "${baseName}"`,
      )
    }

    return freeName
  }

  /**
   * Either name or id must be provided
   */
  async _getAnItem(
    name: string,
    id?: undefined,
    includeInactive?: boolean,
  ): Promise<QBItemRowType>
  async _getAnItem(
    name: undefined,
    id: string,
    includeInactive?: boolean,
  ): Promise<QBItemRowType>
  async _getAnItem(
    name: string,
    id: string,
    includeInactive?: boolean,
  ): Promise<QBItemRowType>
  async _getAnItem(name?: string, id?: string, includeInactive?: boolean) {
    if (!name && !id) {
      throw new APIError(
        httpStatus.BAD_REQUEST,
        'IntuitAPI#getAnItem | At least one of name or id must be provided',
      )
    }

    const sanitizedName = name && escapeForQBQuery(name.trim())
    let queryCondition = sanitizedName
      ? `Name IN ('${sanitizedName}', '${this.getNameWithDeleted(sanitizedName)}')`
      : `Id = '${id}'`
    queryCondition = `${queryCondition} AND Active IN (true${includeInactive ? ', false' : ''})` // By default, QB returns only active items.

    CustomLogger.info({
      message: `IntuitAPI#getAnItem | Item query start for realmId: ${this.tokens.intuitRealmId}. Condition: ${queryCondition}`,
    })
    const customerQuery = `select ${QB_ITEM_COLUMNS.join(', ')} from Item where ${queryCondition} maxresults 1`
    const qbItem = await this.customQuery(customerQuery)

    if (!qbItem) return null

    const parsed = QBItemQueryResponseSchema.parse(qbItem)
    return parsed.Item?.[0] ?? null
  }

  async _getAllItems(limit: number): Promise<QBItemsResponseType | null> {
    CustomLogger.info({
      message: `IntuitAPI#getAllItems | Item query start for realmId: ${this.tokens.intuitRealmId}`,
    })
    // Service items only.
    const customerQuery = `select ${QB_ITEM_COLUMNS.join(', ')} from Item where Type = 'Service' maxresults ${limit}`
    CustomLogger.info({
      obj: { customerQuery },
      message: 'IntuitAPI#getAllItems',
    })
    const qbItems = await this.customQuery(customerQuery)

    if (!qbItems) return null

    const envelope = QBItemQueryResponseSchema.parse(qbItems)
    return QBItemsResponseSchema.parse(envelope.Item || [])
  }

  async _invoiceSparseUpdate(
    payload: QBInvoiceSparseUpdatePayloadType,
  ): Promise<QBInvoiceResponseType> {
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

    assertNotQBFault(invoice, 'invoiceSparseUpdate')

    const parsed = QBInvoiceResponseSchema.parse(invoice)
    CustomLogger.info({
      obj: { response: parsed.Invoice },
      message: `IntuitAPI#InvoiceSparseUpdate | invoice sparse updated for doc number = ${parsed.Invoice?.DocNumber ?? ''}.`,
    })
    return parsed
  }

  async _customerSparseUpdate(
    payload: QBCustomerSparseUpdatePayloadType,
  ): Promise<CustomerQueryResponseType> {
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

    assertNotQBFault(customer, 'customerSparseUpdate')

    const parsed = QBCustomerResponseSchema.parse(customer)
    CustomLogger.info({
      obj: { response: parsed.Customer },
      message: `IntuitAPI#customerSparseUpdate | customer sparse updated with name = ${parsed.Customer.FullyQualifiedName ?? ''}. `,
    })
    return parsed.Customer
  }

  async _itemFullUpdate(
    payload: QBItemFullUpdatePayloadType,
  ): Promise<QBItemResponseType> {
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

    assertNotQBFault(item, 'itemFullUpdate')

    const parsedItem = QBItemResponseSchema.parse(item)

    CustomLogger.info({
      obj: { response: parsedItem.Item },
      message: `IntuitAPI#itemFullUpdate | item full updated with Id = ${parsedItem.Item.Id}.`,
    })
    return parsedItem
  }

  async _updateAccount(
    payload: QBAccountUpdatePayloadType,
  ): Promise<QBAccountResponseType> {
    CustomLogger.info({
      obj: { payload },
      message: `IntuitAPI#updateAccount | Account update start for realmId: ${this.tokens.intuitRealmId}. `,
    })
    const url = `${intuitBaseUrl}/v3/company/${this.tokens.intuitRealmId}/account?minorversion=${intuitApiMinorVersion}`
    const account = await this.postFetchWithHeaders(url, payload)

    if (!account)
      throw new APIError(
        httpStatus.BAD_REQUEST,
        'IntuitAPI#updateAccount | message = no response',
      )

    assertNotQBFault(account, 'updateAccount')

    const parsedAccount = QBAccountResponseSchema.parse(account)

    CustomLogger.info({
      obj: { response: parsedAccount.Account },
      message: `IntuitAPI#updateAccount | Account updated with Id = ${parsedAccount.Account?.Id}.`,
    })
    return parsedAccount
  }

  async _createPayment(
    payload: QBPaymentCreatePayloadType,
  ): Promise<QBPaymentResponseType> {
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

    assertNotQBFault(payment, 'createPayment')

    const parsed = QBPaymentResponseSchema.parse(payment)
    CustomLogger.info({
      obj: { response: parsed.Payment },
      message: `IntuitAPI#createPayment | payment created with Id = ${parsed.Payment.Id}.`,
    })
    return parsed
  }

  async _getInvoice(
    invoiceNumber: string,
  ): Promise<SingleIdAndTokenResponseType | null> {
    CustomLogger.info({
      obj: { invoiceNumber },
      message: `IntuitAPI#getInvoice | invoice query start for realmId: ${this.tokens.intuitRealmId}. `,
    })
    const query = `select ${QB_INVOICE_COLUMNS.join(', ')} from Invoice where DocNumber = '${escapeForQBQuery(invoiceNumber)}' maxresults 1`
    const invoice = await this.customQuery(query)

    if (!invoice)
      throw new APIError(
        httpStatus.BAD_REQUEST,
        'IntuitAPI#getInvoice | message = no response',
      )

    const envelope = QBInvoiceQueryResponseSchema.parse(invoice)
    if (!envelope.Invoice || envelope.Invoice.length === 0) return null

    CustomLogger.info({
      obj: { response: envelope.Invoice },
      message: `IntuitAPI#getInvoice | invoice fetched with doc number = ${invoiceNumber}.`,
    })
    return SingleIdAndTokenResponseSchema.parse(envelope.Invoice[0])
  }

  /**
   * Returns all QBO invoices whose DocNumber starts with `prefix`. Used by
   * findNextAvailableDocNumber to detect collisions and pick the next free
   * suffix before createInvoice. Caps at maxresults=100; if a single prefix
   * has more matches, the caller falls back to catch-6140 retry semantics.
   */
  async _findInvoicesByDocNumberPrefix(
    prefix: string,
  ): Promise<Array<{ Id: string; DocNumber: string; SyncToken: string }>> {
    // LIKE-wildcard chars in user input would broaden the match. Assembly
    // invoice numbers don't contain '%' or '_', but escape defensively.
    const escapedPrefix = escapeForQBQuery(prefix)
      .replace(/%/g, '\\%')
      .replace(/_/g, '\\_')
    const query = `select ${QB_INVOICE_COLUMNS.join(', ')} from Invoice where DocNumber LIKE '${escapedPrefix}%' maxresults 100`
    const response = await this.customQuery(query)
    if (!response) {
      throw new APIError(
        httpStatus.BAD_REQUEST,
        'IntuitAPI#findInvoicesByDocNumberPrefix | message = no response',
      )
    }
    const envelope = QBInvoiceQueryResponseSchema.parse(response)
    if (!envelope.Invoice) return []
    return envelope.Invoice.map((inv) => ({
      Id: inv.Id,
      DocNumber: inv.DocNumber ?? '',
      SyncToken: inv.SyncToken,
    }))
  }

  async _voidInvoice(
    payload: QBDestructiveInvoicePayloadSchema,
  ): Promise<QBInvoiceResponseType> {
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

    assertNotQBFault(invoice, 'voidInvoice')

    const parsed = QBInvoiceResponseSchema.parse(invoice)
    CustomLogger.info({
      obj: { response: parsed.Invoice },
      message: `IntuitAPI#voidInvoice | Voided invoice with Id = ${parsed.Invoice.Id}.`,
    })
    return parsed
  }

  async _deleteInvoice(
    payload: QBDestructiveInvoicePayloadSchema,
  ): Promise<QBInvoiceDeleteResponseType> {
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

    assertNotQBFault(invoice, 'deleteInvoice')

    const parsed = QBInvoiceDeleteResponseSchema.parse(invoice)
    CustomLogger.info({
      obj: { response: parsed.Invoice },
      message: `IntuitAPI#deleteInvoice | Deleted invoice with id = ${parsed.Invoice.Id}. `,
    })
    return parsed
  }

  async _deletePayment(
    payload: QBDeletePayloadType,
  ): Promise<QBPaymentDeleteResponseType> {
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

    assertNotQBFault(payment, 'deletePayment')

    const parsed = QBPaymentDeleteResponseSchema.parse(payment)
    CustomLogger.info({
      obj: { response: parsed.Payment },
      message: `IntuitAPI#deletePayment | payment deleted with Id = ${parsed.Payment.Id}. `,
    })
    return parsed
  }

  /**
   * Either name or id must be provided
   */
  async _getAnAccount(
    accountName: string,
    id?: undefined,
    includeInactive?: boolean,
  ): Promise<QBAccountRowType>
  async _getAnAccount(
    accountName: undefined,
    id: string,
    includeInactive?: boolean,
  ): Promise<QBAccountRowType>
  async _getAnAccount(
    accountName: string,
    id: string,
    includeInactive?: boolean,
  ): Promise<QBAccountRowType>
  async _getAnAccount(
    accountName?: string,
    id?: string,
    includeInactive?: boolean,
  ) {
    CustomLogger.info({
      obj: { realmId: this.tokens.intuitRealmId },
      message: 'IntuitAPI#getAnAccount | Account query start for realmId: ',
    })

    const sanitizedAccountName =
      accountName && escapeForQBQuery(accountName.trim())
    let queryCondition = sanitizedAccountName
      ? `Name IN ('${sanitizedAccountName}', '${this.getNameWithDeleted(sanitizedAccountName)}')`
      : `Id = '${id}'`
    queryCondition = `${queryCondition} AND Active IN (true${includeInactive ? ', false' : ''})` // By default, QB returns only active items.

    const query = `select ${QB_ACCOUNT_COLUMNS.join(', ')} from Account where ${queryCondition}`
    const customQueryRes = await this.customQuery(query)

    if (!customQueryRes) return null

    const parsed = QBAccountQueryResponseSchema.parse(customQueryRes)
    return parsed.Account?.[0] ?? null
  }

  async _createAccount(
    payload: QBAccountCreatePayloadType,
  ): Promise<QBAccountRowType> {
    CustomLogger.info({
      obj: { payload },
      message: `IntuitAPI#createAccount | Account create start for realmId: ${this.tokens.intuitRealmId}. `,
    })
    const url = `${intuitBaseUrl}/v3/company/${this.tokens.intuitRealmId}/account?minorversion=${intuitApiMinorVersion}`
    const account = await this.postFetchWithHeaders(url, payload)

    if (!account)
      throw new APIError(
        httpStatus.BAD_REQUEST,
        'IntuitAPI#createAccount | message = no response',
      )

    assertNotQBFault(account, 'createAccount')

    const parsed = QBAccountResponseSchema.parse(account)
    CustomLogger.info({
      obj: { response: parsed.Account },
      message: `IntuitAPI#createAccount | Account created with Id = ${parsed.Account?.Id}. `,
    })
    return parsed.Account
  }

  async _createPurchase(
    payload: QBPurchaseCreatePayloadType,
  ): Promise<QBPurchaseResponseType> {
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

    assertNotQBFault(purchase, 'createPurchase')

    const parsed = QBPurchaseResponseSchema.parse(purchase)
    CustomLogger.info({
      obj: { response: parsed.Purchase },
      message: `IntuitAPI#createPurchase | Purchase created with Id = ${parsed.Purchase.Id}.`,
    })
    return parsed
  }

  async _createDeposit(
    payload: QBDepositCreatePayloadType,
  ): Promise<QBDepositResponseType> {
    CustomLogger.info({
      obj: { payload },
      message: `IntuitAPI#createDeposit | Deposit create start for realmId: ${this.tokens.intuitRealmId}.`,
    })
    const url = `${intuitBaseUrl}/v3/company/${this.tokens.intuitRealmId}/deposit?minorversion=${intuitApiMinorVersion}`
    const deposit = await this.postFetchWithHeaders(url, payload)

    if (!deposit)
      throw new APIError(
        httpStatus.BAD_REQUEST,
        'IntuitAPI#createDeposit | message = no response',
      )

    assertNotQBFault(deposit, 'createDeposit')

    const parsed = QBDepositResponseSchema.parse(deposit)
    CustomLogger.info({
      obj: { response: parsed.Deposit },
      message: `IntuitAPI#createDeposit | Deposit created with Id = ${parsed.Deposit.Id}.`,
    })
    return parsed
  }

  // Read all pages so we don't miss a deposit on a busy day. Miss one and
  // resync makes a duplicate deposit that QBO won't let us delete. maxPages is
  // just a safety cap — hitting it would need 50k deposits in a single day.
  async _getDepositsByTxnDate(
    txnDate: string,
  ): Promise<Array<{ Id: string; PrivateNote?: string }>> {
    CustomLogger.info({
      obj: { txnDate },
      message: `IntuitAPI#getDepositsByTxnDate | start for realmId: ${this.tokens.intuitRealmId}.`,
    })

    const pageSize = 1000
    const maxPages = 50
    const deposits: Array<{ Id: string; PrivateNote?: string }> = []
    let startPosition = 1

    for (let pages = 0; pages < maxPages; pages++) {
      const query = `select Id, PrivateNote, TxnDate from Deposit where TxnDate = '${escapeForQBQuery(txnDate)}' STARTPOSITION ${startPosition} MAXRESULTS ${pageSize}`
      const response = await this.customQuery(query)
      if (!response) return deposits

      const envelope = QBDepositQueryResponseSchema.parse(response)
      const page = envelope.Deposit ?? []
      deposits.push(...page)

      if (page.length < pageSize) return deposits
      startPosition += pageSize
    }

    CustomLogger.error({
      obj: { txnDate, maxPages },
      message: `IntuitAPI#getDepositsByTxnDate | pagination cap (${maxPages} pages) hit for realmId: ${this.tokens.intuitRealmId} — result truncated at ${deposits.length} deposits.`,
    })
    return deposits
  }

  async _deletePurchase(
    payload: QBDeletePayloadType,
  ): Promise<QBPurchaseDeleteResponseType> {
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

    assertNotQBFault(purchase, 'deletePurchase')

    const parsed = QBPurchaseDeleteResponseSchema.parse(purchase)
    CustomLogger.info({
      obj: { response: parsed.Purchase },
      message: `IntuitAPI#deletePurchase | purchase deleted with Id = ${parsed.Purchase.Id}. `,
    })
    return parsed
  }

  async _getCompanyInfo(): Promise<CompanyInfoType['CompanyInfo'][0]> {
    CustomLogger.info({
      message: `IntuitAPI#getCompanyInfo | Company Info query start for realmId: ${this.tokens.intuitRealmId}.`,
    })
    const query = `SELECT * FROM CompanyInfo maxresults 1`
    const companyInfo = await this.customQuery(query)

    if (!companyInfo)
      throw new APIError(httpStatus.NOT_FOUND, 'No company info found')

    const parsedCompanyInfo = CompanyInfoSchema.parse(companyInfo)
    return parsedCompanyInfo.CompanyInfo[0]
  }

  /**
   * Look up the QBO system "Undeposited Funds" account.
   * Every QBO company has exactly one — it cannot be deleted or recreated.
   * Queries by AccountSubType first (survives user renames), falls back to name.
   */
  async getUndepositedFundsAccountId(): Promise<string> {
    CustomLogger.info({
      message:
        'IntuitAPI#getUndepositedFundsAccountId | Looking up Undeposited Funds account',
    })
    const rawResult = await this.customQuery(
      `SELECT ${QB_ACCOUNT_COLUMNS.join(', ')} FROM Account WHERE AccountSubType = 'UndepositedFunds' AND Active = true maxresults 1`,
    )
    const undepositedAccount = QBAccountQueryResponseSchema.parse(
      rawResult ?? {},
    ).Account?.[0]
    if (undepositedAccount?.Id) {
      CustomLogger.info({
        obj: { account: undepositedAccount },
        message:
          'IntuitAPI#getUndepositedFundsAccountId | Found Undeposited Funds account',
      })
      return undepositedAccount.Id
    }

    const byName = await this.getAnAccount('Undeposited Funds')
    if (byName?.Id) {
      CustomLogger.info({
        obj: { account: byName },
        message:
          'IntuitAPI#getUndepositedFundsAccountId | Found Undeposited Funds account by name',
      })
      return byName.Id
    }

    throw new APIError(
      httpStatus.INTERNAL_SERVER_ERROR,
      'IntuitAPI#getUndepositedFundsAccountId | Undeposited Funds account not found in QuickBooks',
    )
  }

  private wrapWithRetry<Args extends unknown[], R>(
    fn: (...args: Args) => Promise<R>,
    options?: RetryOptions,
  ): (...args: Args) => Promise<R> {
    return (...args: Args): Promise<R> =>
      withRetry(fn.bind(this), args, { idempotent: false, ...options })
  }

  // Writes default to `idempotent: false` (no QBO request-key dedupe — a
  // post-commit retry would duplicate). `customQuery` is the one read in
  // this set and opts back into broad retry. `get*` stay unwrapped and
  // inherit retry via `customQuery` (see withRetry.ts on nesting).
  customQuery = this.wrapWithRetry(this._customQuery, { idempotent: true })
  createInvoice = this.wrapWithRetry(this._createInvoice)
  createCustomer = this.wrapWithRetry(this._createCustomer)
  createItem = this.wrapWithRetry(this._createItem)
  getSingleIncomeAccount = this._getSingleIncomeAccount.bind(this)
  // bind-only: three inner customQuery calls each already retry; wrapping would amplify.
  getAccountsForProductMapping = this._getAccountsForProductMapping.bind(this)
  getACustomer: GetACustomerOverloads = this._getACustomer.bind(
    this,
  ) as unknown as GetACustomerOverloads
  // Intentionally NOT wrapped in wrapWithRetry — a transient 429 mid-walk would
  // replay from page 1 and amplify rate-limit pressure. The inner customQuery
  // calls already retry on 429 (same reasoning as resolveUniqueCustomerName).
  getCustomerByEmail = this._getCustomerByEmail.bind(this)
  getAnItem: GetAnItemOverloads = this._getAnItem.bind(
    this,
  ) as unknown as GetAnItemOverloads
  getAllItems = this._getAllItems.bind(this)
  invoiceSparseUpdate = this.wrapWithRetry(this._invoiceSparseUpdate)
  customerSparseUpdate = this.wrapWithRetry(this._customerSparseUpdate)
  itemFullUpdate = this.wrapWithRetry(this._itemFullUpdate)
  createPayment = this.wrapWithRetry(this._createPayment)
  getInvoice = this._getInvoice.bind(this)
  findInvoicesByDocNumberPrefix = this._findInvoicesByDocNumberPrefix.bind(this)
  voidInvoice = this.wrapWithRetry(this._voidInvoice)
  deleteInvoice = this.wrapWithRetry(this._deleteInvoice)
  getAnAccount: GetAnAccountOverloads = this._getAnAccount.bind(
    this,
  ) as unknown as GetAnAccountOverloads
  createAccount = this.wrapWithRetry(this._createAccount)
  updateAccount = this.wrapWithRetry(this._updateAccount)
  createPurchase = this.wrapWithRetry(this._createPurchase)
  deletePayment = this.wrapWithRetry(this._deletePayment)
  deletePurchase = this.wrapWithRetry(this._deletePurchase)
  createDeposit = this.wrapWithRetry(this._createDeposit)
  getDepositsByTxnDate = this._getDepositsByTxnDate.bind(this)
  getCompanyInfo = this._getCompanyInfo.bind(this)
}
