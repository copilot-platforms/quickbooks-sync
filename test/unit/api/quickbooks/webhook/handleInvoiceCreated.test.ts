/**
 * Unit tests for WebhookService.handleWebhookEvent's INVOICE_CREATED branch.
 * Covers the orchestration in isolation: parse failure, DRAFT skip,
 * already-claimed, happy path, and service-throws → FAILED log.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@sentry/nextjs', () => ({
  withScope: vi.fn((cb: (scope: unknown) => void) =>
    cb({
      setTag: vi.fn(),
      setExtra: vi.fn(),
      addEventProcessor: vi.fn(),
    }),
  ),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  addBreadcrumb: vi.fn(),
  init: vi.fn(),
}))

vi.mock('@/utils/logger', () => ({
  default: { info: vi.fn(), error: vi.fn() },
}))

vi.mock('@/utils/sleep', () => ({
  sleep: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/utils/auth', () => ({
  validateAccessToken: vi.fn(),
  // `@/utils/synclog` (transitively imported via the catch block's
  // getCategory/getDeletedAtForAuthAccountCategoryLog) reads this constant.
  refreshTokenExpireMessage: 'Refresh token is expired',
}))

// `@/utils/copilotAPI` pulls in `copilot-node-sdk`, which has an ESM directory
// import that breaks under Vitest's resolver. We don't exercise it here, so
// stub it out completely.
vi.mock('@/utils/copilotAPI', () => ({
  CopilotAPI: vi.fn(),
}))

// `@/utils/intuitAPI` is imported transitively by `@/utils/error`
// (`IntuitAPIErrorMessage`). The default export is the IntuitAPI class which
// we don't exercise here either.
vi.mock('@/utils/intuitAPI', () => ({
  default: vi.fn(),
  IntuitAPIErrorMessage: '#IntuitAPIErrorMessage#',
}))

// `BaseService` imports `@/db`, which immediately calls `postgres(databaseUrl)`
// at module init. Unit tests have no DATABASE_URL, so stub the module.
vi.mock('@/db', () => ({
  db: {},
  client: {},
}))

// `new SyncLogService(...)` requires a constructable mock — `vi.fn()` arrow
// implementations aren't constructors, so we use a plain `function` factory.
// See `docs/vitest-gotchas.md` and the same pattern in
// `test/integration/setup.ts` for IntuitAPI/CopilotAPI.
const claimWebhookEvent = vi.fn()
const updateOrCreateQBSyncLog = vi.fn()
vi.mock('@/app/api/quickbooks/syncLog/syncLog.service', () => ({
  SyncLogService: vi.fn(function () {
    return {
      claimWebhookEvent,
      updateOrCreateQBSyncLog,
    }
  }),
}))

const webhookInvoiceCreated = vi.fn()
vi.mock('@/app/api/quickbooks/invoice/invoice.service', () => ({
  InvoiceService: vi.fn(function () {
    return {
      webhookInvoiceCreated,
    }
  }),
}))

// Settings service is also instantiated for PRICE/PRODUCT events; provide a
// no-op so the import graph resolves cleanly.
vi.mock('@/app/api/quickbooks/setting/setting.service', () => ({
  SettingService: vi.fn(function () {
    return {
      getOneByPortalId: vi
        .fn()
        .mockResolvedValue({ createNewProductFlag: true }),
    }
  }),
}))

import { WebhookService } from '@/app/api/quickbooks/webhook/webhook.service'
import User from '@/app/api/core/models/User.model'
import { EntityType, EventType, LogStatus } from '@/app/api/core/types/log'
import type { IntuitAPITokensType } from '@/utils/intuitAPI'

const stubUser = {
  workspaceId: 'test-portal-00000001',
  token: 'tkn',
  qbConnection: undefined,
} as unknown as User

const tokens: IntuitAPITokensType = {
  accessToken: 'access',
  refreshToken: 'refresh',
  intuitRealmId: 'realm-1',
  expiresIn: 3600,
  XRefreshTokenExpiresIn: 8_726_400,
  tokenSetTime: new Date(),
  incomeAccountRef: '100',
  assetAccountRef: '101',
  expenseAccountRef: '102',
} as unknown as IntuitAPITokensType

const validInvoicePayload = {
  eventType: 'invoice.created',
  data: {
    id: 'inv-cop-0001',
    number: 'INV-0001',
    status: 'open',
    total: 60000,
    clientId: '11111111-1111-1111-1111-111111111111',
    companyId: '',
    lineItems: [
      {
        amount: 60000,
        quantity: 1,
        description: 'x',
        productId: 'p',
        priceId: 'pr',
      },
    ],
    paymentMethodPreferences: [],
    taxAmount: 0,
    taxPercentage: null,
  },
}

describe('WebhookService.handleWebhookEvent — INVOICE_CREATED branch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('parse failure: skips claim and service when payload is malformed', async () => {
    const svc = new WebhookService(stubUser)
    const malformed = {
      eventType: 'invoice.created',
      data: { number: 'INV-0001' /* missing id, status, lineItems, etc. */ },
    }
    await svc.handleWebhookEvent(malformed as never, tokens)
    expect(claimWebhookEvent).not.toHaveBeenCalled()
    expect(webhookInvoiceCreated).not.toHaveBeenCalled()
  })

  it('DRAFT skip: returns before claim or service work', async () => {
    const svc = new WebhookService(stubUser)
    const draft = {
      ...validInvoicePayload,
      data: { ...validInvoicePayload.data, status: 'draft' },
    }
    await svc.handleWebhookEvent(draft as never, tokens)
    expect(claimWebhookEvent).not.toHaveBeenCalled()
    expect(webhookInvoiceCreated).not.toHaveBeenCalled()
  })

  it('already claimed: skips webhookInvoiceCreated when claim returns false', async () => {
    claimWebhookEvent.mockResolvedValueOnce({ claimed: false })
    const svc = new WebhookService(stubUser)
    await svc.handleWebhookEvent(validInvoicePayload as never, tokens)
    expect(claimWebhookEvent).toHaveBeenCalledTimes(1)
    expect(webhookInvoiceCreated).not.toHaveBeenCalled()
  })

  it('happy path: invokes webhookInvoiceCreated when claim succeeds', async () => {
    claimWebhookEvent.mockResolvedValueOnce({ claimed: true })
    webhookInvoiceCreated.mockResolvedValueOnce(undefined)
    const svc = new WebhookService(stubUser)
    await svc.handleWebhookEvent(validInvoicePayload as never, tokens)
    expect(webhookInvoiceCreated).toHaveBeenCalledTimes(1)
    const [parsedResource, passedTokens] = webhookInvoiceCreated.mock.calls[0]
    expect(parsedResource.data.id).toBe('inv-cop-0001')
    expect(passedTokens).toBe(tokens)
    expect(updateOrCreateQBSyncLog).not.toHaveBeenCalled()
  })

  it('service throws: writes a FAILED log via updateOrCreateQBSyncLog', async () => {
    claimWebhookEvent.mockResolvedValueOnce({ claimed: true })
    webhookInvoiceCreated.mockRejectedValueOnce(new Error('boom'))
    const svc = new WebhookService(stubUser)
    await svc.handleWebhookEvent(validInvoicePayload as never, tokens)
    expect(updateOrCreateQBSyncLog).toHaveBeenCalledTimes(1)
    expect(updateOrCreateQBSyncLog).toHaveBeenCalledWith(
      expect.objectContaining({
        portalId: 'test-portal-00000001',
        entityType: EntityType.INVOICE,
        eventType: EventType.CREATED,
        status: LogStatus.FAILED,
        copilotId: 'inv-cop-0001',
        invoiceNumber: 'INV-0001',
      }),
    )
    const [logPayload] = updateOrCreateQBSyncLog.mock.calls[0]
    expect(logPayload.errorMessage).toContain('boom')
  })
})
