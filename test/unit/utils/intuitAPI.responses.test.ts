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

  it('getSingleIncomeAccount parses the SQL it actually issues (Id + Name + SyncToken + Active)', async () => {
    // Regression guard: SQL projection must satisfy QBAccountRowSchema.
    vi.mocked(getFetcher).mockResolvedValue(
      queryResponse({
        Account: [
          {
            Id: '42',
            Name: 'Sales of Product Income',
            SyncToken: '0',
            Active: true,
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
    })
  })

  it('getSingleIncomeAccount throws APIError on Fault response', async () => {
    vi.mocked(getFetcher).mockResolvedValue(faultResponse())

    const api = makeApi()
    await expect(api.getSingleIncomeAccount()).rejects.toBeInstanceOf(APIError)
  })

  it('getAllItems parses rows from a caller-supplied column projection that omits Active', async () => {
    // Regression guard: mirrors backfillProductInfo's column list (no Active).
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
    const result = await api.getAllItems(100, [
      'Id',
      'Name',
      'UnitPrice',
      'Description',
      'SyncToken',
    ])

    expect(result).toHaveLength(2)
    expect(result?.[0]).toEqual({
      Id: '1',
      Name: 'Service A',
      UnitPrice: 100,
      Description: 'desc',
      SyncToken: '0',
    })
  })

  it('getAllItems returns parsed empty array when QBO omits the Item key', async () => {
    vi.mocked(getFetcher).mockResolvedValue(queryResponse({}))

    const api = makeApi()
    const result = await api.getAllItems(100, [
      'Id',
      'Name',
      'UnitPrice',
      'SyncToken',
    ])

    expect(result).toEqual([])
  })

  it('getAnAccount parses a single-row account match', async () => {
    vi.mocked(getFetcher).mockResolvedValue(
      queryResponse({
        Account: [{ Id: '7', Name: 'Assets', SyncToken: '0', Active: true }],
      }),
    )

    const api = makeApi()
    const result = await api.getAnAccount('Assets')

    expect(result?.Id).toBe('7')
    expect(result?.SyncToken).toBe('0')
  })

  it('getAnAccount returns null when no Account key is present', async () => {
    vi.mocked(getFetcher).mockResolvedValue(queryResponse({}))

    const api = makeApi()
    const result = await api.getAnAccount('NoSuchAccount')

    expect(result).toBeNull()
  })

  it('getAnItem parses a single-row item match with the SQL columns it projects', async () => {
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

  it('getInvoice parses an invoice match and reduces to Id+SyncToken', async () => {
    vi.mocked(getFetcher).mockResolvedValue(
      queryResponse({
        Invoice: [{ Id: '100', SyncToken: '0', DocNumber: 'INV-1' }],
      }),
    )

    const api = makeApi()
    const result = await api.getInvoice('INV-1')

    expect(result).toEqual({ Id: '100', SyncToken: '0' })
  })

  it('getInvoice returns null when QBO returns an empty Invoice array', async () => {
    vi.mocked(getFetcher).mockResolvedValue(queryResponse({ Invoice: [] }))

    const api = makeApi()
    const result = await api.getInvoice('INV-MISSING')

    expect(result).toBeNull()
  })

  it('getCompanyInfo tolerates a CompanyInfo row without Country', async () => {
    vi.mocked(getFetcher).mockResolvedValue(
      queryResponse({ CompanyInfo: [{}] }),
    )

    const api = makeApi()
    const result = await api.getCompanyInfo()

    expect(result.Country).toBeUndefined()
  })

  it('getCompanyInfo passes Country through when present', async () => {
    vi.mocked(getFetcher).mockResolvedValue(
      queryResponse({ CompanyInfo: [{ Country: 'US' }] }),
    )

    const api = makeApi()
    const result = await api.getCompanyInfo()

    expect(result.Country).toBe('US')
  })

  it('getACustomer parses a single-row customer match', async () => {
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

  it('createInvoice parses the envelope and returns the full response', async () => {
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
    })

    expect(result.Invoice.Id).toBe('500')
    expect(result.Invoice.SyncToken).toBe('0')
  })

  it('createInvoice throws APIError on Fault', async () => {
    vi.mocked(postFetcher).mockResolvedValue(faultResponse())

    const api = makeApi()
    await expect(
      api.createInvoice({ Line: [], CustomerRef: { value: 'c1' } }),
    ).rejects.toBeInstanceOf(APIError)
  })

  it('createCustomer parses the envelope and returns the inner Customer', async () => {
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

  it('createItem parses the envelope and returns the inner Item', async () => {
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

  it('createAccount parses the envelope and returns the inner Account', async () => {
    vi.mocked(postFetcher).mockResolvedValue({
      Account: { Id: '300', Name: 'New Asset', SyncToken: '0', Active: true },
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

  it('createPayment parses the envelope and returns the full response', async () => {
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

  it('voidInvoice parses the envelope returned by void operation', async () => {
    vi.mocked(postFetcher).mockResolvedValue({
      Invoice: { Id: '500', SyncToken: '1', DocNumber: 'INV-500' },
    })

    const api = makeApi()
    const result = await api.voidInvoice({ Id: '500', SyncToken: '0' })

    expect(result.Invoice.Id).toBe('500')
    expect(result.Invoice.SyncToken).toBe('1')
  })

  it('deleteInvoice parses the deletion-confirmation envelope (no full row)', async () => {
    vi.mocked(postFetcher).mockResolvedValue({
      Invoice: { Id: '500', status: 'Deleted', domain: 'QBO' },
    })

    const api = makeApi()
    const result = await api.deleteInvoice({ Id: '500', SyncToken: '0' })

    expect(result.Invoice.Id).toBe('500')
    expect(result.Invoice.status).toBe('Deleted')
  })
})
