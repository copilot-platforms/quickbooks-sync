/**
 * Integration coverage for the daily refresh-token cron (OUT-3574).
 *
 * What this exercises end-to-end:
 *   - The `getPortalsWithExpiringRefreshTokens` SQL — interval math + LIMIT
 *     ordering by soonest-to-expire.
 *   - The route → controller → service path, including Bearer auth.
 *   - Persistence: each refreshed portal's row gets the new tokens written.
 *
 * What this does NOT exercise (covered elsewhere):
 *   - Race-vs-revocation handling inside `getRefreshedQbTokenInfo` →
 *     test/unit/utils/tokenRefresh.test.ts
 *   - Loop-level error isolation and counters →
 *     test/unit/api/quickbooks/refresh-tokens/refresh-tokens.service.test.ts
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { testApiHandler } from 'next-test-api-route-handler'

import { db } from '@/db'
import { QBPortalConnection } from '@/db/schema/qbPortalConnections'
import * as appHandler from '@/app/api/quickbooks/refresh-tokens/route'

import { truncateAllTestTables } from '@test/helpers/testDb'
import { seedPortalConnection, seedSetting } from '@test/helpers/seed'

// `@/utils/intuit` (the OAuth wrapper) isn't part of the shared integration
// `setup.ts` mocks, so we install it here. A real refresh would hit the
// Intuit sandbox and rotate the seeded refresh token, which would make the
// DB-write assertions non-deterministic.
const getRefreshedQBToken = vi.fn()
vi.mock('@/utils/intuit', () => ({
  default: { getInstance: () => ({ getRefreshedQBToken }) },
}))

const CRON_AUTH = `Bearer ${process.env.CRON_SECRET}`

const ONE_DAY_S = 24 * 60 * 60
const REFRESH_TTL_S = 8_726_400 // 101 days — what Intuit returns

/**
 * Builds a `tokenSetTime` such that the refresh token is `daysToExpiry` away
 * from expiring. The selector treats anything with <14 days remaining as due.
 */
const tokenSetTimeForDaysToExpiry = (daysToExpiry: number) =>
  new Date(Date.now() - (REFRESH_TTL_S - daysToExpiry * ONE_DAY_S) * 1000)

async function callCron(headers: Record<string, string> = {}) {
  let response!: Response
  await testApiHandler({
    appHandler,
    test: async ({ fetch }) => {
      response = await fetch({ method: 'GET', headers })
    },
  })
  return response
}

describe('GET /api/quickbooks/refresh-tokens', () => {
  beforeEach(async () => {
    await truncateAllTestTables()
    vi.clearAllMocks()
    getRefreshedQBToken.mockResolvedValue({
      access_token: 'fresh-access',
      refresh_token: 'fresh-refresh',
      expires_in: 3600,
      x_refresh_token_expires_in: REFRESH_TTL_S,
      token_type: 'bearer',
    })
  })

  it('rejects requests without the cron bearer token', async () => {
    // Same auth contract as the existing `/api/quickbooks/cron` endpoint.
    // Crons run from Vercel's scheduler with the secret injected; anyone
    // else hitting the URL must get 401.
    const res = await callCron()
    expect(res.status).toBe(401)
    expect(getRefreshedQBToken).not.toHaveBeenCalled()
  })

  it('refreshes portals inside the 14-day window and skips the rest', async () => {
    // Three portals: two due (5d, 10d remaining), one safe (30d — outside
    // the 14-day lead window). Verifies the SQL interval predicate and that
    // we don't touch portals outside the lead window — important because
    // Intuit's response on a not-yet-expiring token may not actually rotate
    // the refresh value, making those calls pure overhead.
    const due1 = await seedPortalConnection({
      portalId: 'p-due-1',
      intuitRealmId: 'realm-due-1',
      refreshToken: 'old-due-1',
      tokenSetTime: tokenSetTimeForDaysToExpiry(5),
    })
    await seedSetting({ portalId: 'p-due-1', syncFlag: true })
    const due2 = await seedPortalConnection({
      portalId: 'p-due-2',
      intuitRealmId: 'realm-due-2',
      refreshToken: 'old-due-2',
      tokenSetTime: tokenSetTimeForDaysToExpiry(10),
    })
    await seedSetting({ portalId: 'p-due-2', syncFlag: true })
    await seedPortalConnection({
      portalId: 'p-safe',
      intuitRealmId: 'realm-safe',
      refreshToken: 'old-safe',
      tokenSetTime: tokenSetTimeForDaysToExpiry(30),
    })
    await seedSetting({ portalId: 'p-safe', syncFlag: true })

    const res = await callCron({ authorization: CRON_AUTH })
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      success: true,
      scanned: 2,
      refreshed: 2,
      reconnectRequired: 0,
      errored: 0,
    })

    expect(getRefreshedQBToken).toHaveBeenCalledTimes(2)
    // Soonest-to-expire first — guards the ORDER BY in the selector so a
    // saturated batch always tackles the most-urgent portals.
    expect(getRefreshedQBToken).toHaveBeenNthCalledWith(1, 'old-due-1')
    expect(getRefreshedQBToken).toHaveBeenNthCalledWith(2, 'old-due-2')

    const updated1 = await db
      .select()
      .from(QBPortalConnection)
      .where(eq(QBPortalConnection.id, due1.id))
    expect(updated1[0]).toMatchObject({
      accessToken: 'fresh-access',
      refreshToken: 'fresh-refresh',
    })

    const updated2 = await db
      .select()
      .from(QBPortalConnection)
      .where(eq(QBPortalConnection.id, due2.id))
    expect(updated2[0]).toMatchObject({
      accessToken: 'fresh-access',
      refreshToken: 'fresh-refresh',
    })

    const safe = await db
      .select()
      .from(QBPortalConnection)
      .where(eq(QBPortalConnection.portalId, 'p-safe'))
    expect(safe[0].refreshToken).toBe('old-safe')
  })

  it('skips soft-deleted portals, portals without settings, and portals with syncFlag=false', async () => {
    // Three exclusion paths the selector enforces:
    //   - soft-deleted rows: off-limits to all background jobs.
    //   - no qb_settings row at all: sync was never configured for this
    //     portal — refreshing the token would be wasted Intuit traffic.
    //   - syncFlag=false: IU explicitly disabled sync; honor that.
    await seedPortalConnection({
      portalId: 'p-deleted',
      intuitRealmId: 'realm-deleted',
      refreshToken: 'old-deleted',
      tokenSetTime: tokenSetTimeForDaysToExpiry(3),
      deletedAt: new Date(),
    })
    await seedSetting({ portalId: 'p-deleted', syncFlag: true })

    await seedPortalConnection({
      portalId: 'p-no-settings',
      intuitRealmId: 'realm-no-settings',
      refreshToken: 'old-no-settings',
      tokenSetTime: tokenSetTimeForDaysToExpiry(3),
    })

    await seedPortalConnection({
      portalId: 'p-sync-off',
      intuitRealmId: 'realm-sync-off',
      refreshToken: 'old-sync-off',
      tokenSetTime: tokenSetTimeForDaysToExpiry(3),
    })
    await seedSetting({ portalId: 'p-sync-off', syncFlag: false })

    const res = await callCron({ authorization: CRON_AUTH })
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({
      scanned: 0,
      refreshed: 0,
    })
    expect(getRefreshedQBToken).not.toHaveBeenCalled()
  })
})
