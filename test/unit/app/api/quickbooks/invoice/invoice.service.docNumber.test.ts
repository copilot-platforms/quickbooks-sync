/**
 * Unit coverage for InvoiceService#resolveAvailableDocNumber — the pre-flight
 * helper used by webhookInvoiceCreated to dodge 6240 collisions. The public
 * retry-after-6240 branch is covered end-to-end in
 * test/integration/quickbooks/invoiceCreated/qboDocNumberCollision.test.ts;
 * this file pins the focused pieces in isolation.
 *
 * resolveAvailableDocNumber is private, so we reach in via a type cast. The
 * alternative — exporting the method or only testing through the public
 * webhookInvoiceCreated — would either widen the API surface or require
 * stubbing every CustomerService/ProductService dependency, which adds noise
 * without adding signal for this particular logic.
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

vi.mock('@/utils/copilotAPI', () => ({
  CopilotAPI: vi.fn(),
}))

vi.mock('@/utils/intuitAPI', () => ({
  default: vi.fn(),
  IntuitAPIErrorMessage: '#IntuitAPIErrorMessage#',
}))

// BaseService imports `@/db`, which initialises postgres at module load.
vi.mock('@/db', () => ({
  db: {},
  client: {},
}))

// SyncLogService is instantiated in the InvoiceService constructor.
vi.mock('@/app/api/quickbooks/syncLog/syncLog.service', () => ({
  SyncLogService: vi.fn(function () {
    return {}
  }),
}))

// vi.mock factories are hoisted above any module-level `const`, so the spy
// has to be declared via vi.hoisted to be referenceable from the factory.
const { captureSyncError } = vi.hoisted(() => ({
  captureSyncError: vi.fn(),
}))
vi.mock('@/utils/sentry', () => ({
  addSyncBreadcrumb: vi.fn(),
  captureSyncError,
}))

import { InvoiceService } from '@/app/api/quickbooks/invoice/invoice.service'
import User from '@/app/api/core/models/User.model'
import { MAX_SUFFIX_ATTEMPTS } from '@/app/api/quickbooks/invoice/invoice.utils'
import type IntuitAPI from '@/utils/intuitAPI'

const stubUser = {
  workspaceId: 'test-portal-00000001',
  token: 'tkn',
  qbConnection: undefined,
} as unknown as User

// `resolveAvailableDocNumber` is private on InvoiceService; the cast below is
// the cheapest way to exercise it directly without changing the production
// API surface.
type WithResolveDocNumber = {
  resolveAvailableDocNumber: (
    intuitApi: Pick<IntuitAPI, 'findInvoicesByDocNumberPrefix'>,
    assemblyInvoiceNumber: string,
  ) => Promise<string>
}

const newSvc = () =>
  new InvoiceService(stubUser) as unknown as WithResolveDocNumber

describe('InvoiceService#resolveAvailableDocNumber', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns the base DocNumber when QBO reports no collisions', async () => {
    const intuit = {
      findInvoicesByDocNumberPrefix: vi.fn().mockResolvedValue([]),
    } as unknown as IntuitAPI

    const result = await newSvc().resolveAvailableDocNumber(intuit, 'INV-0001')

    expect(result).toBe('INV-0001')
    expect(intuit.findInvoicesByDocNumberPrefix).toHaveBeenCalledWith('INV-0001')
    expect(captureSyncError).not.toHaveBeenCalled()
  })

  it('walks past taken slots and returns the lowest free suffix', async () => {
    const intuit = {
      findInvoicesByDocNumberPrefix: vi.fn().mockResolvedValue([
        { Id: '1', DocNumber: 'INV-0001', SyncToken: '0' },
        { Id: '2', DocNumber: 'INV-0001-1', SyncToken: '0' },
        // Unrelated DocNumber returned by the LIKE query — must be ignored.
        { Id: '3', DocNumber: 'INV-00010', SyncToken: '0' },
      ]),
    } as unknown as IntuitAPI

    const result = await newSvc().resolveAvailableDocNumber(intuit, 'INV-0001')

    expect(result).toBe('INV-0001-2')
  })

  it('reports unrecoverable exhaustion to Sentry and re-throws', async () => {
    const taken = [{ Id: '0', DocNumber: 'INV-0001', SyncToken: '0' }]
    for (let n = 1; n <= MAX_SUFFIX_ATTEMPTS; n++) {
      taken.push({ Id: `${n}`, DocNumber: `INV-0001-${n}`, SyncToken: '0' })
    }
    const intuit = {
      findInvoicesByDocNumberPrefix: vi.fn().mockResolvedValue(taken),
    } as unknown as IntuitAPI

    await expect(
      newSvc().resolveAvailableDocNumber(intuit, 'INV-0001'),
    ).rejects.toThrow(/no available DocNumber/)

    // We want Sentry context for engineers — area tag + portal/invoice/taken
    // count — so re-syncs don't silently chew through retries forever.
    expect(captureSyncError).toHaveBeenCalledTimes(1)
    const [, tags, extras] = captureSyncError.mock.calls[0]
    expect(tags).toEqual({ area: 'docnumber-walk-unresolvable' })
    expect(extras).toMatchObject({
      portalId: 'test-portal-00000001',
      assemblyInvoiceNumber: 'INV-0001',
      takenCount: MAX_SUFFIX_ATTEMPTS + 1,
    })
  })
})
