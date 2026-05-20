// Exercises the production .parse paths against canonical QBO response
// shapes. Integration tests mock @/utils/intuitAPI wholesale, so these
// schemas otherwise never run against realistic input in CI.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@sentry/nextjs', () => ({
  withScope: vi.fn(),
  captureMessage: vi.fn(),
  captureException: vi.fn(),
}))

vi.mock('@/utils/logger', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('@/helper/fetch.helper', () => ({
  getFetcher: vi.fn(),
  postFetcher: vi.fn(),
}))

import IntuitAPI, { IntuitAPITokensType } from '@/utils/intuitAPI'
import { getFetcher, postFetcher } from '@/helper/fetch.helper'
import APIError from '@/app/api/core/exceptions/api'

const baseTokens: IntuitAPITokensType = {
  accessToken: 'access',
  refreshToken: 'refresh',
  intuitRealmId: 'realm-1',
  incomeAccountRef: 'income',
  expenseAccountRef: 'expense',
  assetAccountRef: 'asset',
  serviceItemRef: 'service',
  clientFeeRef: 'client-fee',
}

function makeApi() {
  return new IntuitAPI(baseTokens)
}

function queryResponse(body: Record<string, unknown>) {
  return { QueryResponse: body }
}

function faultResponse() {
  return {
    Fault: {
      Error: [{ Message: 'Bad request', Detail: 'detail', code: '6000' }],
    },
  }
}

describe('IntuitAPI customQuery-based reads', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('getSingleIncomeAccount returns the income account when QBO responds with a single matching row', async () => {
    // Regression guard: SQL projection must satisfy QBAccountRowSchema.
    vi.mocked(getFetcher).mockResolvedValue(
      queryResponse({
        Account: [
          {
            Id: '42',
            Name: 'Sales of Product Income',
            SyncToken: '0',
            Active: true,
            AccountType: 'Income',
          },
        ],
      }),
    )

    const api = makeApi()
    const result = await api.getSingleIncomeAccount()

    expect(result).toEqual({
      Id: '42',
      Name: 'Sales of Product Income',
      SyncToken: '0',
      Active: true,
      AccountType: 'Income',
    })
  })

  it('getSingleIncomeAccount throws an APIError whose status matches the QBO fault code', async () => {
    vi.mocked(getFetcher).mockResolvedValue(faultResponse())

    const api = makeApi()
    const err = await api.getSingleIncomeAccount().catch((e) => e)

    expect(err).toBeInstanceOf(APIError)
    expect(err.status).toBe(6000)
    expect(err.errors).toEqual([
      { code: 6000, Message: 'Bad request', Detail: 'detail' },
    ])
  })

  it('getSingleIncomeAccount falls back to status 400 when the QBO fault has no usable code', async () => {
    // Schema maps missing / null / empty / non-numeric `code` to undefined;
    // assertNotQBFault falls back to BAD_REQUEST. Test covers the missing
    // branch; the others converge on the same undefined output.
    vi.mocked(getFetcher).mockResolvedValue({
      Fault: {
        Error: [{ Message: 'Unknown', Detail: 'no code field' }],
      },
    })

    const api = makeApi()
    const err = await api.getSingleIncomeAccount().catch((e) => e)

    expect(err).toBeInstanceOf(APIError)
    expect(err.status).toBe(400)
    expect((err.errors as Array<{ code?: number }>)[0].code).toBeUndefined()
  })

  it('getAllItems returns every item, including rows whose Description is null', async () => {
    vi.mocked(getFetcher).mockResolvedValue(
      queryResponse({
        Item: [
          {
            Id: '1',
            Name: 'Service A',
            UnitPrice: 100,
            Description: 'desc',
            SyncToken: '0',
          },
          {
            Id: '2',
            Name: 'Service B',
            UnitPrice: 200,
            Description: null,
            SyncToken: '0',
          },
        ],
      }),
    )

    const api = makeApi()
    const result = await api.getAllItems(100)

    expect(result).toHaveLength(2)
    expect(result?.[0]).toEqual({
      Id: '1',
      Name: 'Service A',
      UnitPrice: 100,
      Description: 'desc',
      SyncToken: '0',
    })
  })

  it('getAllItems returns an empty array when QBO omits the Item key entirely', async () => {
    vi.mocked(getFetcher).mockResolvedValue(queryResponse({}))

    const api = makeApi()
    const result = await api.getAllItems(100)

    expect(result).toEqual([])
  })

  it('getAnAccount returns the account when QBO responds with a single match', async () => {
    vi.mocked(getFetcher).mockResolvedValue(
      queryResponse({
        Account: [
          {
            Id: '7',
            Name: 'Assets',
            SyncToken: '0',
            Active: true,
            AccountType: 'OtherCurrentAsset',
          },
        ],
      }),
    )

    const api = makeApi()
    const result = await api.getAnAccount('Assets')

    expect(result?.Id).toBe('7')
    expect(result?.SyncToken).toBe('0')
  })

  it('getAnAccount returns null when QBO returns no Account in the response', async () => {
    vi.mocked(getFetcher).mockResolvedValue(queryResponse({}))

    const api = makeApi()
    const result = await api.getAnAccount('NoSuchAccount')

    expect(result).toBeNull()
  })

  it('getAnItem returns the item when QBO responds with a single match', async () => {
    vi.mocked(getFetcher).mockResolvedValue(
      queryResponse({
        Item: [
          {
            Id: '9',
            SyncToken: '0',
            ClassRef: { name: 'cls', value: 'c1' },
            Active: true,
            Name: 'Widget',
            UnitPrice: 50,
          },
        ],
      }),
    )

    const api = makeApi()
    const result = await api.getAnItem('Widget')

    expect(result?.Id).toBe('9')
    expect(result?.Name).toBe('Widget')
    expect(result?.UnitPrice).toBe(50)
  })

  it('getInvoice returns the invoice Id and SyncToken when a match is found', async () => {
    vi.mocked(getFetcher).mockResolvedValue(
      queryResponse({
        Invoice: [{ Id: '100', SyncToken: '0', DocNumber: 'INV-1' }],
      }),
    )

    const api = makeApi()
    const result = await api.getInvoice('INV-1')

    expect(result).toEqual({ Id: '100', SyncToken: '0' })
  })

  it('getInvoice returns null when QBO returns an empty Invoice list', async () => {
    vi.mocked(getFetcher).mockResolvedValue(queryResponse({ Invoice: [] }))

    const api = makeApi()
    const result = await api.getInvoice('INV-MISSING')

    expect(result).toBeNull()
  })

  it('getCompanyInfo returns the row even when Country is missing', async () => {
    vi.mocked(getFetcher).mockResolvedValue(
      queryResponse({ CompanyInfo: [{}] }),
    )

    const api = makeApi()
    const result = await api.getCompanyInfo()

    expect(result.Country).toBeUndefined()
  })

  it('getCompanyInfo returns the Country when QBO includes it', async () => {
    vi.mocked(getFetcher).mockResolvedValue(
      queryResponse({ CompanyInfo: [{ Country: 'US' }] }),
    )

    const api = makeApi()
    const result = await api.getCompanyInfo()

    expect(result.Country).toBe('US')
  })

  it('getACustomer returns the customer when QBO responds with a single match', async () => {
    vi.mocked(getFetcher).mockResolvedValue(
      queryResponse({
        Customer: [
          {
            Id: '5',
            SyncToken: '0',
            Active: true,
            CompanyName: 'Acme',
            PrimaryEmailAddr: { Address: 'a@b.com' },
          },
        ],
      }),
    )

    const api = makeApi()
    const result = await api.getACustomer('Acme')

    expect(result?.Id).toBe('5')
    expect(result?.PrimaryEmailAddr?.Address).toBe('a@b.com')
  })
})

describe('IntuitAPI POST-based writes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('createInvoice returns the created invoice when QBO accepts the request', async () => {
    vi.mocked(postFetcher).mockResolvedValue({
      Invoice: {
        Id: '500',
        SyncToken: '0',
        DocNumber: 'INV-500',
        TotalAmt: 100,
      },
    })

    const api = makeApi()
    const result = await api.createInvoice({
      Line: [],
      CustomerRef: { value: 'c1' },
      PrivateNote: 'Assembly invoice: TEST-001',
    })

    expect(result.Invoice.Id).toBe('500')
    expect(result.Invoice.SyncToken).toBe('0')
  })

  it('createInvoice throws an APIError whose status matches the QBO fault code', async () => {
    vi.mocked(postFetcher).mockResolvedValue(faultResponse())

    const api = makeApi()
    const err = await api
      .createInvoice({
        Line: [],
        CustomerRef: { value: 'c1' },
        PrivateNote: 'Assembly invoice: TEST-001',
      })
      .catch((e) => e)

    expect(err).toBeInstanceOf(APIError)
    expect(err.status).toBe(6000)
    expect(err.errors).toEqual([
      { code: 6000, Message: 'Bad request', Detail: 'detail' },
    ])
  })

  it('createCustomer returns the created customer when QBO accepts the request', async () => {
    vi.mocked(postFetcher).mockResolvedValue({
      Customer: {
        Id: '50',
        SyncToken: '0',
        Active: true,
        FullyQualifiedName: 'Acme',
      },
    })

    const api = makeApi()
    const result = await api.createCustomer({
      PrimaryEmailAddr: { Address: 'a@b.com' },
    })

    expect(result.Id).toBe('50')
    expect(result.FullyQualifiedName).toBe('Acme')
  })

  it('createItem returns the created item when QBO accepts the request', async () => {
    vi.mocked(postFetcher).mockResolvedValue({
      Item: {
        Id: '200',
        SyncToken: '0',
        Name: 'Widget',
        Active: true,
        UnitPrice: 25,
      },
    })

    const api = makeApi()
    const result = await api.createItem({
      Name: 'Widget',
      UnitPrice: 25,
      Type: 'Service' as never,
      Taxable: false,
    })

    expect(result.Id).toBe('200')
    expect(result.UnitPrice).toBe(25)
  })

  it('createAccount returns the created account when QBO accepts the request', async () => {
    vi.mocked(postFetcher).mockResolvedValue({
      Account: {
        Id: '300',
        Name: 'New Asset',
        SyncToken: '0',
        Active: true,
        AccountType: 'Asset',
      },
    })

    const api = makeApi()
    const result = await api.createAccount({
      Name: 'New Asset',
      AccountType: 'Asset',
      Active: true,
      Classification: 'Asset',
    })

    expect(result.Id).toBe('300')
    expect(result.Name).toBe('New Asset')
  })

  it('createPayment returns the created payment when QBO accepts the request', async () => {
    vi.mocked(postFetcher).mockResolvedValue({
      Payment: { Id: '400', SyncToken: '0', TotalAmt: 100 },
    })

    const api = makeApi()
    const result = await api.createPayment({
      TotalAmt: 100,
      CustomerRef: { value: 'c1' },
      Line: [],
    })

    expect(result.Payment.Id).toBe('400')
    expect(result.Payment.SyncToken).toBe('0')
  })

  it('voidInvoice returns the voided invoice when QBO confirms the void', async () => {
    vi.mocked(postFetcher).mockResolvedValue({
      Invoice: { Id: '500', SyncToken: '1', DocNumber: 'INV-500' },
    })

    const api = makeApi()
    const result = await api.voidInvoice({ Id: '500', SyncToken: '0' })

    expect(result.Invoice.Id).toBe('500')
    expect(result.Invoice.SyncToken).toBe('1')
  })

  it('deleteInvoice returns the deletion confirmation when QBO confirms the delete', async () => {
    vi.mocked(postFetcher).mockResolvedValue({
      Invoice: { Id: '500', status: 'Deleted', domain: 'QBO' },
    })

    const api = makeApi()
    const result = await api.deleteInvoice({ Id: '500', SyncToken: '0' })

    expect(result.Invoice.Id).toBe('500')
    expect(result.Invoice.status).toBe('Deleted')
  })
})
