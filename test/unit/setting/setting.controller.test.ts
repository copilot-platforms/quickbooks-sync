import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { NextRequest } from 'next/server'

// Spies are declared via vi.hoisted so the vi.mock factories below (which are
// hoisted above the imports) can reference them.
const {
  updateQBSettings,
  updateQBPortalConnection,
  getOneByPortalId,
  getPortalConnection,
  isPortalInBankDepositABTest,
  transaction,
} = vi.hoisted(() => ({
  updateQBSettings: vi.fn(),
  updateQBPortalConnection: vi.fn(),
  getOneByPortalId: vi.fn(),
  getPortalConnection: vi.fn(),
  isPortalInBankDepositABTest: vi.fn(),
  transaction: vi.fn(),
}))

vi.mock('@/db', () => ({ db: { transaction }, client: {} }))
vi.mock('@/db/service/token.service', () => ({ getPortalConnection }))
vi.mock('@/app/api/core/utils/authenticate', () => ({
  default: vi.fn(async () => ({ workspaceId: 'portal-1', token: 'token' })),
}))
vi.mock('@/app/api/quickbooks/setting/setting.service', () => ({
  SettingService: vi.fn(function () {
    return {
      setTransaction: vi.fn(),
      unsetTransaction: vi.fn(),
      updateQBSettings,
      getOneByPortalId,
    }
  }),
}))
vi.mock('@/app/api/quickbooks/token/token.service', () => ({
  TokenService: vi.fn(function () {
    return {
      setTransaction: vi.fn(),
      unsetTransaction: vi.fn(),
      updateQBPortalConnection,
    }
  }),
}))
vi.mock('@/utils/abTesting', () => ({ isPortalInBankDepositABTest }))

import {
  getSettings,
  updateSettings,
} from '@/app/api/quickbooks/setting/setting.controller'

// Minimal request stub: the controller only reads the `type` search param and
// the JSON body.
function invoiceSettingsRequest(body: Record<string, unknown>): NextRequest {
  return {
    nextUrl: { searchParams: new URLSearchParams({ type: 'invoice' }) },
    json: async () => ({ type: 'invoice', ...body }),
  } as unknown as NextRequest
}

function getSettingsRequest(type: string): NextRequest {
  return {
    nextUrl: { searchParams: new URLSearchParams({ type }) },
  } as unknown as NextRequest
}

const baseInvoiceBody = {
  absorbedFeeFlag: true,
  useCompanyNameFlag: false,
}

describe('updateSettings — bank deposit AB gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    updateQBSettings.mockImplementation(async (payload) => ({
      id: 'setting-1',
      ...payload,
    }))
    transaction.mockImplementation(async (cb) => cb({}))
  })

  it('drops the bank deposit flag for a portal that is not in the AB test', async () => {
    isPortalInBankDepositABTest.mockReturnValue(false)

    await updateSettings(
      invoiceSettingsRequest({
        ...baseInvoiceBody,
        bankDepositFeeFlag: true,
        bankAccountRef: 'account-1',
      }),
    )

    expect(updateQBSettings).toHaveBeenCalledTimes(1)
    const savedPayload = updateQBSettings.mock.calls[0][0]
    expect(savedPayload).not.toHaveProperty('bankDepositFeeFlag')
    // Bank account ref is never written for a non-AB portal, even when supplied.
    expect(updateQBPortalConnection).not.toHaveBeenCalled()
  })

  it('saves the flag and the bank account ref for an AB-test portal', async () => {
    isPortalInBankDepositABTest.mockReturnValue(true)

    await updateSettings(
      invoiceSettingsRequest({
        ...baseInvoiceBody,
        bankDepositFeeFlag: true,
        bankAccountRef: 'account-9',
      }),
    )

    const savedPayload = updateQBSettings.mock.calls[0][0]
    expect(savedPayload.bankDepositFeeFlag).toBe(true)
    expect(updateQBPortalConnection).toHaveBeenCalledWith(
      { bankAccountRef: 'account-9' },
      expect.anything(),
    )
  })

  it('lets an AB-test portal turn the flag off without a bank account', async () => {
    isPortalInBankDepositABTest.mockReturnValue(true)

    await updateSettings(
      invoiceSettingsRequest({
        ...baseInvoiceBody,
        bankDepositFeeFlag: false,
      }),
    )

    const savedPayload = updateQBSettings.mock.calls[0][0]
    expect(savedPayload.bankDepositFeeFlag).toBe(false)
    expect(updateQBPortalConnection).not.toHaveBeenCalled()
  })
})

describe('getSettings — bankDepositEnabled signal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getOneByPortalId.mockResolvedValue({ id: 'setting-1' })
    getPortalConnection.mockResolvedValue({ bankAccountRef: 'account-1' })
  })

  it('reports the AB gate as the bankDepositEnabled flag for invoice settings', async () => {
    isPortalInBankDepositABTest.mockReturnValue(true)

    const response = await getSettings(getSettingsRequest('invoice'))

    expect(await response.json()).toMatchObject({ bankDepositEnabled: true })
  })

  it('reports bankDepositEnabled false for an excluded portal', async () => {
    isPortalInBankDepositABTest.mockReturnValue(false)

    const response = await getSettings(getSettingsRequest('invoice'))

    expect(await response.json()).toMatchObject({ bankDepositEnabled: false })
  })

  it('never enables the signal for non-invoice settings', async () => {
    isPortalInBankDepositABTest.mockReturnValue(true)

    const response = await getSettings(getSettingsRequest('product'))

    expect(await response.json()).toMatchObject({ bankDepositEnabled: false })
    // The gate is not even consulted outside invoice settings.
    expect(isPortalInBankDepositABTest).not.toHaveBeenCalled()
  })
})
