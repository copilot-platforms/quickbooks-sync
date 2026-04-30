import { getPortalsWithExpiringRefreshTokens } from '@/db/service/token.service'
import {
  QBReconnectRequiredError,
  getRefreshedQbTokenInfo,
} from '@/utils/tokenRefresh'
import CustomLogger from '@/utils/logger'
import * as Sentry from '@sentry/nextjs'

/**
 * Daily refresh-token sweep.
 *
 * Refresh anything inside this window. 14 daily passes gives plenty of
 * headroom to recover from extended outages (broken deploy left over a long
 * weekend, multi-day Intuit incident) before refresh tokens actually expire
 * (~100 days). The cost of refreshing earlier than strictly needed is a
 * single extra Intuit call per portal — refreshing at day 14 vs day 1 is the
 * same shape of request.
 */
export const REFRESH_TOKEN_LEAD_DAYS = 14

/**
 * Per-run cap. Sized for the non-Fluid-Compute 300 s function budget on
 * Vercel with real-world latency in mind: a flaky/rate-limited Intuit can push
 * a single refresh to 5+ s after `withRetry` backoff. 120 finishes in ~120 s
 * at the typical 1 s/portal and leaves headroom (~60 portals at 5 s/portal)
 * before timeout. Any portal not reached today gets picked up tomorrow — the
 * 14-day lead window absorbs the deferral without any token actually expiring.
 */
export const REFRESH_TOKEN_BATCH_LIMIT = 120

export type RefreshTokensSummary = {
  scanned: number
  refreshed: number
  reconnectRequired: number
  errored: number
}

/**
 * Iterates portals with refresh tokens nearing expiry and rotates each via
 * the existing `getRefreshedQbTokenInfo` helper, which handles the Intuit
 * call, DB persistence, and concurrent-refresh races.
 *
 * Errors are isolated per portal so one failure (revocation, network blip)
 * never poisons the rest of the batch. Revocation handling is intentionally
 * left to the existing webhook auth path that has Copilot user context;
 * here we only log and continue.
 */
export async function refreshExpiringTokens(): Promise<RefreshTokensSummary> {
  const rows = await getPortalsWithExpiringRefreshTokens(
    REFRESH_TOKEN_LEAD_DAYS,
    REFRESH_TOKEN_BATCH_LIMIT,
  )

  CustomLogger.info({
    obj: { count: rows.length, leadDays: REFRESH_TOKEN_LEAD_DAYS },
    message: 'refreshExpiringTokens | starting batch',
  })

  const summary: RefreshTokensSummary = {
    scanned: rows.length,
    refreshed: 0,
    reconnectRequired: 0,
    errored: 0,
  }

  for (const row of rows) {
    try {
      await getRefreshedQbTokenInfo(row.portalId, row)
      summary.refreshed += 1
    } catch (error: unknown) {
      if (error instanceof QBReconnectRequiredError) {
        summary.reconnectRequired += 1
        CustomLogger.error({
          obj: {
            portalId: error.portalId,
            intuitRealmId: error.intuitRealmId,
          },
          message:
            'refreshExpiringTokens | refresh token revoked — reconnect required',
        })
        Sentry.withScope((scope) => {
          scope.setTag('portalId', error.portalId)
          scope.setTag('intuitRealmId', error.intuitRealmId)
          Sentry.captureException(error)
        })
        continue
      }

      summary.errored += 1
      CustomLogger.error({
        obj: { portalId: row.portalId, error },
        message: 'refreshExpiringTokens | refresh failed for portal',
      })
      Sentry.withScope((scope) => {
        scope.setTag('portalId', row.portalId)
        scope.setTag('intuitRealmId', row.intuitRealmId)
        Sentry.captureException(error)
      })
    }
  }

  CustomLogger.info({
    obj: summary,
    message: 'refreshExpiringTokens | batch complete',
  })

  return summary
}
