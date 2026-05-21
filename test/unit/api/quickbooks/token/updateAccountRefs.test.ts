/**
 * TokenService.updateAccountRefs writes incoming refs to qb_portal_connections
 * scoped by portalId. The dashboard is the only caller and every ref came from
 * GET /api/quickbooks/accounts, so no per-ref QBO validation runs here.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@sentry/nextjs', () => ({
  withScope: vi.fn(),
  captureMessage: vi.fn(),
  captureException: vi.fn(),
}))
vi.mock('@/utils/logger', () => ({
  default: { info: vi.fn(), error: vi.fn() },
}))

// Stub IntuitAPI + CopilotAPI so importing TokenService doesn't transitively
// load copilot-node-sdk (which has an ESM directory-import that breaks under
// vitest). See docs/vitest-gotchas.md.
vi.mock('@/utils/intuitAPI', () => ({
  default: vi.fn(),
  IntuitAPIErrorMessage: '#IntuitAPIErrorMessage#',
}))
vi.mock('@/utils/copilotAPI', () => ({
  CopilotAPI: vi.fn(),
}))

import { TokenService } from '@/app/api/quickbooks/token/token.service'
import APIError from '@/app/api/core/exceptions/api'
import User from '@/app/api/core/models/User.model'

const fakeUser = new User('test-token', {
  workspaceId: 'portal-1',
  internalUserId: 'user-1',
})

function makeService(updateReturn: unknown = { id: 'pc-1' }) {
  const service = new TokenService(fakeUser)
  // Spy on the inherited update so we can assert payload + WHERE clause without
  // touching Postgres.
  ;(service as any).updateQBPortalConnection = vi
    .fn()
    .mockResolvedValue(updateReturn)
  return service
}

describe('TokenService.updateAccountRefs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('writes only the provided refs, scoped by portal_id', async () => {
    const service = makeService()
    await service.updateAccountRefs({ incomeAccountRef: '300' })

    expect((service as any).updateQBPortalConnection).toHaveBeenCalledTimes(1)
    const [accountRefs, where] = (service as any).updateQBPortalConnection.mock
      .calls[0]
    expect(accountRefs).toEqual({ incomeAccountRef: '300' })
    const chunks = (where as { queryChunks?: unknown[] }).queryChunks ?? []
    const referencesPortalId = chunks.some(
      (c) => (c as { name?: string })?.name === 'portal_id',
    )
    expect(referencesPortalId).toBe(true)
  })

  it('writes all three refs when all are provided', async () => {
    const service = makeService()
    await service.updateAccountRefs({
      incomeAccountRef: '300',
      expenseAccountRef: '301',
      assetAccountRef: '302',
    })
    const [accountRefs] = (service as any).updateQBPortalConnection.mock
      .calls[0]
    expect(accountRefs).toEqual({
      incomeAccountRef: '300',
      expenseAccountRef: '301',
      assetAccountRef: '302',
    })
  })

  it('throws 500 when the update matches no row (portal connection missing)', async () => {
    // updateQBPortalConnection yields a falsy value when WHERE matches zero
    // rows (Drizzle destructures `.returning()`'s first element). Pass null
    // — undefined would collide with makeService's default parameter.
    const service = makeService(null)
    await expect(
      service.updateAccountRefs({ incomeAccountRef: '300' }),
    ).rejects.toBeInstanceOf(APIError)
  })

  it('rejects an empty payload via the schema refine', async () => {
    const service = makeService()
    await expect(service.updateAccountRefs({})).rejects.toThrow()
    expect((service as any).updateQBPortalConnection).not.toHaveBeenCalled()
  })
})
