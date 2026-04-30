/**
 * Unit tests for the daily refresh-token cron service (OUT-3574).
 *
 * Coverage:
 *   - Selector + per-row loop driver: each returned row triggers exactly one
 *     `getRefreshedQbTokenInfo` call.
 *   - Error isolation: a single failure (revocation, transient error) doesn't
 *     short-circuit the rest of the batch.
 *   - Revocation handling: `QBReconnectRequiredError` is counted separately
 *     and Sentry-captured but does NOT mutate any portal state — that's
 *     intentional, scoped out of OUT-3574.
 *   - Summary shape: counters reflect what actually happened.
 *
 * The DB selector and the helper itself have their own tests; here we mock
 * both so we can exercise the loop semantics in isolation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Scope shape mirrors the integration `setup.ts` mock so future Sentry calls
// the service grows (e.g., `addEventProcessor` from withRetry chains) don't
// break these unit tests with confusing `is not a function` errors.
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
}))

vi.mock('@/utils/logger', () => ({
  default: { info: vi.fn(), error: vi.fn() },
}))

const getPortalsWithExpiringRefreshTokens = vi.fn()
vi.mock('@/db/service/token.service', () => ({
  getPortalsWithExpiringRefreshTokens: (days: number, limit: number) =>
    getPortalsWithExpiringRefreshTokens(days, limit),
}))

// Full mock of `@/utils/tokenRefresh` — using `vi.importActual` would pull in
// the real module, which transitively loads `@/db` and tries to bind to a
// Postgres URL. Unit tests don't have one, so we ship a hand-rolled
// `QBReconnectRequiredError` stand-in matching the real public shape.
//
// `vi.hoisted` is required because `vi.mock` factories run before any
// top-level statement, including the class declaration — referencing a
// non-hoisted symbol would throw at module init.
const { getRefreshedQbTokenInfo, MockQBReconnectRequiredError } = vi.hoisted(
  () => {
    class MockQBReconnectRequiredError extends Error {
      readonly portalId: string
      readonly intuitRealmId: string
      readonly intiatedBy: string | null
      constructor(args: {
        portalId: string
        intuitRealmId: string
        intiatedBy: string | null
      }) {
        super('mock reconnect required')
        this.name = 'QBReconnectRequiredError'
        this.portalId = args.portalId
        this.intuitRealmId = args.intuitRealmId
        this.intiatedBy = args.intiatedBy
      }
    }
    return {
      getRefreshedQbTokenInfo: vi.fn(),
      MockQBReconnectRequiredError,
    }
  },
)
vi.mock('@/utils/tokenRefresh', () => ({
  getRefreshedQbTokenInfo: (portalId: string, row: unknown) =>
    getRefreshedQbTokenInfo(portalId, row),
  QBReconnectRequiredError: MockQBReconnectRequiredError,
}))

import {
  refreshExpiringTokens,
  REFRESH_TOKEN_BATCH_LIMIT,
  REFRESH_TOKEN_LEAD_DAYS,
} from '@/app/api/quickbooks/refresh-tokens/refresh-tokens.service'
import { QBReconnectRequiredError } from '@/utils/tokenRefresh'

const makeRow = (portalId: string) => ({
  id: `id-${portalId}`,
  portalId,
  intuitRealmId: `realm-${portalId}`,
  accessToken: 'access',
  refreshToken: 'refresh',
  expiresIn: 3600,
  XRefreshTokenExpiresIn: 8_726_400,
  tokenType: 'bearer',
  tokenSetTime: new Date(),
  intiatedBy: 'iu',
  incomeAccountRef: 'i',
  expenseAccountRef: 'e',
  assetAccountRef: 'a',
  serviceItemRef: null,
  clientFeeRef: null,
  isSuspended: false,
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
})

describe('refreshExpiringTokens', () => {
  beforeEach(() => {
    getPortalsWithExpiringRefreshTokens.mockReset()
    getRefreshedQbTokenInfo.mockReset()
  })

  it('queries the selector with the documented lead window and batch cap', async () => {
    // Guards the contract that this cron — not callers — owns the policy
    // numbers. Callers should never pass overrides.
    getPortalsWithExpiringRefreshTokens.mockResolvedValueOnce([])

    await refreshExpiringTokens()

    expect(getPortalsWithExpiringRefreshTokens).toHaveBeenCalledExactlyOnceWith(
      REFRESH_TOKEN_LEAD_DAYS,
      REFRESH_TOKEN_BATCH_LIMIT,
    )
  })

  it('refreshes each returned portal exactly once and returns counts', async () => {
    const rows = [makeRow('p1'), makeRow('p2'), makeRow('p3')]
    getPortalsWithExpiringRefreshTokens.mockResolvedValueOnce(rows)
    getRefreshedQbTokenInfo.mockResolvedValue({})

    const summary = await refreshExpiringTokens()

    expect(getRefreshedQbTokenInfo).toHaveBeenCalledTimes(3)
    // Pass the row through so `getRefreshedQbTokenInfo` can use it as the
    // race-detection baseline (see tokenRefresh.ts) instead of re-reading.
    expect(getRefreshedQbTokenInfo).toHaveBeenNthCalledWith(1, 'p1', rows[0])
    expect(getRefreshedQbTokenInfo).toHaveBeenNthCalledWith(2, 'p2', rows[1])
    expect(getRefreshedQbTokenInfo).toHaveBeenNthCalledWith(3, 'p3', rows[2])
    expect(summary).toEqual({
      scanned: 3,
      refreshed: 3,
      reconnectRequired: 0,
      errored: 0,
    })
  })

  it('isolates errors per portal so one failure does not poison the batch', async () => {
    // Critical for an unattended cron — a single bad portal must not block
    // the rest of the day's refresh work, otherwise stragglers pile up
    // until they actually expire.
    const rows = [makeRow('ok-1'), makeRow('boom'), makeRow('ok-2')]
    getPortalsWithExpiringRefreshTokens.mockResolvedValueOnce(rows)
    getRefreshedQbTokenInfo
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error('network blip'))
      .mockResolvedValueOnce({})

    const summary = await refreshExpiringTokens()

    expect(getRefreshedQbTokenInfo).toHaveBeenCalledTimes(3)
    expect(summary).toEqual({
      scanned: 3,
      refreshed: 2,
      reconnectRequired: 0,
      errored: 1,
    })
  })

  it('counts QBReconnectRequiredError separately and continues the batch', async () => {
    // Revocation is a real, expected outcome (user disconnected QBO in the
    // Intuit admin UI). It surfaces as a distinct counter so dashboards can
    // alert on it without conflating with transient network errors. Per
    // OUT-3574 scope, we do NOT auto-suspend the portal here — that's
    // tracked separately and stays the responsibility of the existing
    // webhook auth path that has Copilot user context.
    const rows = [makeRow('ok-1'), makeRow('revoked'), makeRow('ok-2')]
    getPortalsWithExpiringRefreshTokens.mockResolvedValueOnce(rows)
    getRefreshedQbTokenInfo
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(
        new QBReconnectRequiredError({
          portalId: 'revoked',
          intuitRealmId: 'realm-revoked',
          intiatedBy: 'iu',
        }),
      )
      .mockResolvedValueOnce({})

    const summary = await refreshExpiringTokens()

    expect(summary).toEqual({
      scanned: 3,
      refreshed: 2,
      reconnectRequired: 1,
      errored: 0,
    })
  })

  it('returns zeroed counters and skips the loop when no portals are due', async () => {
    // No rows is the steady-state expectation on most days — the lead
    // window is wide enough that most portals won't fall inside it.
    getPortalsWithExpiringRefreshTokens.mockResolvedValueOnce([])

    const summary = await refreshExpiringTokens()

    expect(getRefreshedQbTokenInfo).not.toHaveBeenCalled()
    expect(summary).toEqual({
      scanned: 0,
      refreshed: 0,
      reconnectRequired: 0,
      errored: 0,
    })
  })
})
