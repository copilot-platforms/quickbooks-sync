/**
 * Unit tests for `src/utils/tokenRefresh.ts` — the proactive-refresh +
 * cross-worker-race-safe token helper at the heart of OUT-3621.
 *
 * Coverage focus:
 *   - Proactive buffer logic: `getValidQbTokens` refreshes when the token is
 *     within `REFRESH_BUFFER_SECONDS` of expiry, and only then.
 *   - Race-vs-revocation detection: `getRefreshedQbTokenInfo` distinguishes
 *     "another worker refreshed first" (recoverable) from "refresh token
 *     genuinely revoked" (surface via `QBReconnectRequiredError`), using a
 *     `tokenSetTime` comparison instead of `now()` so it's clock-skew-free.
 *   - State-mutation contract: on revocation, the helper throws WITHOUT
 *     touching `syncFlag`. Disabling sync + notifying IUs is the caller's
 *     responsibility (see `AuthService.getQBPortalConnection`).
 *
 * Not covered here (left for integration tests):
 *   - The DB write actually persists (Drizzle / Postgres).
 *   - The Intuit SDK's real behavior on invalid_grant.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// `@sentry/nextjs` is mocked proactively because the transitive import graph
// from `tokenRefresh.ts` (via the db service → Copilot SDK) has hit ESM
// directory-import crashes in vitest before. Cheap to stub; avoids the
// issue entirely.
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

// `getPortalConnection` is read at least once per helper call, and twice on
// the `invalid_grant` path (entry-time snapshot + post-failure re-read for
// race detection). Tests configure `mockResolvedValueOnce` in that order.
const getPortalConnection = vi.fn()
vi.mock('@/db/service/token.service', () => ({
  getPortalConnection: (portalId: string) => getPortalConnection(portalId),
}))

const getRefreshedQBToken = vi.fn()
vi.mock('@/utils/intuit', () => ({
  default: {
    getInstance: () => ({ getRefreshedQBToken }),
  },
}))

// Lightweight drizzle-query mock. The real code uses two shapes:
//   await db.update(t).set(p).where(c).returning(cols)   // portal update
//   await db.update(t).set(p).where(c)                   // (removed in OUT-3621, kept for resilience)
// The `whereResult` object supports both: `.returning()` resolves to a
// returned-rows array; the raw thenable resolves to `undefined` so a caller
// awaiting `.where(...)` directly works too. Each path records one entry in
// `dbUpdates` so assertions can distinguish which table was written.
type DbUpdateCall = { table: unknown; payload: unknown }
const dbUpdates: DbUpdateCall[] = []

vi.mock('@/db', () => {
  const makeChain = (table: unknown) => {
    let payload: unknown
    const whereResult: {
      returning: () => Promise<{ id: string }[]>
      then: (onFulfilled?: (value: undefined) => unknown) => Promise<unknown>
    } = {
      returning: () => {
        dbUpdates.push({ table, payload })
        return Promise.resolve([{ id: 'updated-id' }])
      },
      // Thenable hook: makes `await db.update(...).set(...).where(...)`
      // (no `.returning()`) resolve cleanly and still record the write.
      then: (onFulfilled) => {
        dbUpdates.push({ table, payload })
        return Promise.resolve(undefined).then(onFulfilled)
      },
    }
    return {
      set: (p: unknown) => {
        payload = p
        return { where: () => whereResult }
      },
    }
  }
  return { db: { update: makeChain } }
})

import {
  getValidQbTokens,
  getRefreshedQbTokenInfo,
  QBReconnectRequiredError,
  REFRESH_BUFFER_SECONDS,
} from '@/utils/tokenRefresh'
import { IntuitOAuthError } from '@/app/api/core/exceptions/custom'
import { QBPortalConnection } from '@/db/schema/qbPortalConnections'

// Baseline row mirroring a healthy `qb_portal_connections` record. Tests
// override only the fields relevant to the scenario (usually `tokenSetTime`).
const basePortalRow = {
  id: 'row-id',
  portalId: 'portal-abc',
  intuitRealmId: 'realm-123',
  accessToken: 'stored-access',
  refreshToken: 'stored-refresh',
  expiresIn: 3600,
  XRefreshTokenExpiresIn: 8640000,
  tokenType: 'bearer',
  tokenSetTime: new Date(),
  intiatedBy: 'iu-user-1',
  incomeAccountRef: 'income-ref',
  expenseAccountRef: 'expense-ref',
  assetAccountRef: 'asset-ref',
  serviceItemRef: 'service-ref',
  clientFeeRef: 'client-fee-ref',
  isSuspended: false,
  createdAt: new Date(),
  updatedAt: new Date(),
}

/**
 * Builds the shape `isIntuitOAuthError` recognizes. Use with
 * `getRefreshedQBToken.mockRejectedValueOnce(makeOAuthError('invalid_grant'))`
 * to simulate specific Intuit OAuth failure modes.
 */
function makeOAuthError(code: string): IntuitOAuthError {
  return new IntuitOAuthError({
    error: code,
    error_description: `mock ${code}`,
    intuit_tid: 'tid',
  })
}

describe('getValidQbTokens', () => {
  beforeEach(() => {
    getPortalConnection.mockReset()
    getRefreshedQBToken.mockReset()
    dbUpdates.length = 0
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns stored tokens without refresh when token has plenty of time left', async () => {
    // Guards the proactive-buffer logic: outside the buffer we must return
    // the stored tokens unchanged. A regression here would revive the
    // "refresh on every call" anti-pattern this ticket replaces.
    getPortalConnection.mockResolvedValueOnce({
      ...basePortalRow,
      // 2000s old out of 3600s lifetime → 1600s remaining → well outside the
      // 600s (10-min) buffer, so no refresh expected.
      tokenSetTime: new Date(Date.now() - 2000 * 1000),
    })

    const tokens = await getValidQbTokens('portal-abc')

    expect(tokens.accessToken).toBe('stored-access')
    expect(getRefreshedQBToken).not.toHaveBeenCalled()
    expect(dbUpdates).toHaveLength(0)
  })

  it('refreshes when token is within the 10-min buffer of expiry', async () => {
    // Two `getPortalConnection` calls expected on the refresh path: once in
    // `getValidQbTokens` (freshness check) and once in `getRefreshedQbTokenInfo`
    // (snapshot before calling Intuit, used for later race detection).
    getPortalConnection
      .mockResolvedValueOnce({
        ...basePortalRow,
        // 55 minutes old of 60 min lifetime → 5 min remaining → within buffer.
        tokenSetTime: new Date(Date.now() - 55 * 60 * 1000),
      })
      .mockResolvedValueOnce({
        ...basePortalRow,
        tokenSetTime: new Date(Date.now() - 55 * 60 * 1000),
      })

    getRefreshedQBToken.mockResolvedValueOnce({
      access_token: 'fresh-access',
      refresh_token: 'fresh-refresh',
      expires_in: 3600,
      x_refresh_token_expires_in: 8640000,
      token_type: 'bearer',
    })

    const tokens = await getValidQbTokens('portal-abc')

    expect(tokens.accessToken).toBe('fresh-access')
    expect(tokens.refreshToken).toBe('fresh-refresh')
    expect(getRefreshedQBToken).toHaveBeenCalledExactlyOnceWith(
      'stored-refresh',
    )
    // Exactly one DB write: the portal-connection update persisting new tokens.
    expect(dbUpdates).toEqual([
      expect.objectContaining({ table: QBPortalConnection }),
    ])
  })

  it('treats missing tokenSetTime as expired', async () => {
    // Edge case: a portal row can exist without `tokenSetTime` (legacy rows,
    // or mid-insert states). The helper must conservatively refresh rather
    // than assuming freshness.
    getPortalConnection
      .mockResolvedValueOnce({ ...basePortalRow, tokenSetTime: null })
      .mockResolvedValueOnce({ ...basePortalRow, tokenSetTime: null })

    getRefreshedQBToken.mockResolvedValueOnce({
      access_token: 'fresh-access',
      refresh_token: 'fresh-refresh',
      expires_in: 3600,
      x_refresh_token_expires_in: 8640000,
      token_type: 'bearer',
    })

    await getValidQbTokens('portal-abc')

    expect(getRefreshedQBToken).toHaveBeenCalled()
  })

  it('throws when portal connection is not found', async () => {
    getPortalConnection.mockResolvedValueOnce(null)

    await expect(getValidQbTokens('portal-abc')).rejects.toThrow(
      /Portal connection not found/,
    )
  })
})

describe('getRefreshedQbTokenInfo', () => {
  beforeEach(() => {
    getPortalConnection.mockReset()
    getRefreshedQBToken.mockReset()
    dbUpdates.length = 0
  })

  it('happy path: calls Intuit, persists new tokens, returns them', async () => {
    getPortalConnection.mockResolvedValueOnce(basePortalRow)
    getRefreshedQBToken.mockResolvedValueOnce({
      access_token: 'fresh-access',
      refresh_token: 'fresh-refresh',
      expires_in: 3600,
      x_refresh_token_expires_in: 8640000,
      token_type: 'bearer',
    })

    const tokens = await getRefreshedQbTokenInfo('portal-abc')

    expect(tokens.accessToken).toBe('fresh-access')
    expect(dbUpdates).toEqual([
      expect.objectContaining({ table: QBPortalConnection }),
    ])
  })

  it('invalid_grant with DB row advanced → returns winner tokens (race)', async () => {
    // Cross-worker race scenario: Worker A and Worker B both enter the
    // refresh path at t1. A wins, consumes the refresh token, writes new
    // tokens at t2 — now the shared `refresh_token` in the DB is different.
    // B's call to Intuit fails with `invalid_grant` because the refresh
    // token B held has already been rotated.
    //
    // Simulating B here: its entry-time snapshot has `tokenSetTime = t1`;
    // the re-read after the Intuit failure sees `tokenSetTime = t2`. Since
    // t2 > t1, we know this is a race (not a revocation) and the correct
    // recovery is to return A's freshly-persisted tokens.
    const t1 = new Date('2026-04-21T10:00:00Z')
    const t2 = new Date('2026-04-21T10:00:05Z')
    getPortalConnection
      .mockResolvedValueOnce({ ...basePortalRow, tokenSetTime: t1 })
      // Re-read inside `handleInvalidGrant`: Worker A already wrote its row.
      .mockResolvedValueOnce({
        ...basePortalRow,
        tokenSetTime: t2,
        accessToken: 'winner-access',
        refreshToken: 'winner-refresh',
      })

    getRefreshedQBToken.mockRejectedValueOnce(makeOAuthError('invalid_grant'))

    const tokens = await getRefreshedQbTokenInfo('portal-abc')

    // Race recovery: B returns A's tokens as if it had refreshed itself.
    expect(tokens.accessToken).toBe('winner-access')
    expect(tokens.refreshToken).toBe('winner-refresh')
    // Critically, B does not write the DB — A's row is the source of truth.
    expect(dbUpdates).toHaveLength(0)
  })

  it('invalid_grant with unchanged DB → throws QBReconnectRequiredError without mutating state', async () => {
    // Genuine revocation scenario: the portal owner disconnected QBO in the
    // Intuit admin UI, or their refresh token was invalidated for some
    // other reason. No concurrent worker refreshed — the DB row is
    // unchanged between entry-time snapshot and post-failure re-read.
    //
    // Contract: the helper must throw `QBReconnectRequiredError` *without*
    // touching `syncFlag` or notifying IUs. Those side effects live in
    // `AuthService.getQBPortalConnection` where a Copilot user context
    // exists; keeping them out of here avoids fragmenting the "disable
    // sync + notify" pair across unrelated code paths.
    const t1 = new Date('2026-04-21T10:00:00Z')
    getPortalConnection
      .mockResolvedValueOnce({ ...basePortalRow, tokenSetTime: t1 })
      // Same tokenSetTime — no race.
      .mockResolvedValueOnce({ ...basePortalRow, tokenSetTime: t1 })

    getRefreshedQBToken.mockRejectedValueOnce(makeOAuthError('invalid_grant'))

    const err = await getRefreshedQbTokenInfo('portal-abc').catch(
      (e: unknown) => e,
    )

    expect(err).toBeInstanceOf(QBReconnectRequiredError)
    expect((err as QBReconnectRequiredError).portalId).toBe('portal-abc')
    expect((err as QBReconnectRequiredError).intuitRealmId).toBe('realm-123')
    // `intiatedBy` is passed through so the caller can attribute the IU
    // notification to the user who originally connected QBO.
    expect((err as QBReconnectRequiredError).intiatedBy).toBe('iu-user-1')
    // No DB mutation — the cornerstone of the post-review invariant.
    expect(dbUpdates).toHaveLength(0)
  })

  it('non-invalid_grant OAuth errors propagate', async () => {
    // Only `invalid_grant` gets the race-vs-revocation special path. Every
    // other Intuit OAuth error (server_error, temporary_failure, etc.) is
    // a transient/unknown failure that should bubble up so the caller's
    // retry / error-reporting stack can handle it normally.
    getPortalConnection.mockResolvedValueOnce(basePortalRow)
    getRefreshedQBToken.mockRejectedValueOnce(makeOAuthError('server_error'))

    await expect(getRefreshedQbTokenInfo('portal-abc')).rejects.toThrow()
    expect(dbUpdates).toHaveLength(0)
  })

  it('generic (non-OAuth) errors propagate', async () => {
    // Network failures, DNS issues, timeouts — anything that isn't a
    // structured Intuit OAuth error should pass through untouched.
    getPortalConnection.mockResolvedValueOnce(basePortalRow)
    getRefreshedQBToken.mockRejectedValueOnce(new Error('network boom'))

    await expect(getRefreshedQbTokenInfo('portal-abc')).rejects.toThrow(
      'network boom',
    )
    expect(dbUpdates).toHaveLength(0)
  })
})

describe('REFRESH_BUFFER_SECONDS', () => {
  // Guards the contractual buffer value. A change here should be deliberate
  // and probably needs stakeholder discussion — this value trades refresh
  // frequency against mid-request expiry risk (see tokenRefresh.ts docs).
  it('is 10 minutes', () => {
    expect(REFRESH_BUFFER_SECONDS).toBe(600)
  })
})
