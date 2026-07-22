import { isIntuitOAuthError } from '@/app/api/core/exceptions/custom'
import { OAuthErrorCodes } from '@/constant/intuitErrorCode'
import { db } from '@/db'
import {
  QBPortalConnection,
  QBPortalConnectionSelectSchemaType,
  QBPortalConnectionUpdateSchemaType,
} from '@/db/schema/qbPortalConnections'
import { getPortalConnection } from '@/db/service/token.service'
import Intuit from '@/utils/intuit'
import type { IntuitAPITokensType } from '@/utils/intuitAPI'
import CustomLogger from '@/utils/logger'
import dayjs from 'dayjs'
import { and, eq } from 'drizzle-orm'

/**
 * Refresh proactively when less than this many seconds remain on the token.
 * Intuit access tokens live 3600s; 15 min gives buffer for long-running sync
 * jobs, queue latency, and mild clock skew between the app server and Intuit.
 */
export const REFRESH_BUFFER_SECONDS = 15 * 60

/**
 * Thrown when the QBO refresh token has been genuinely revoked (as opposed to
 * losing a race with a concurrent refresh). This is a signal — no side effects
 * have fired. Callers with a Copilot user context (e.g. `AuthService`) are
 * responsible for disabling `syncFlag` and notifying IUs together. Callers
 * without that context (server actions, CLIs on read-only paths) may safely
 * swallow — the next path that catches it will do the cleanup.
 */
export class QBReconnectRequiredError extends Error {
  readonly portalId: string
  readonly intuitRealmId: string
  readonly intiatedBy: string | null

  constructor(args: {
    portalId: string
    intuitRealmId: string
    intiatedBy: string | null
  }) {
    super(
      `QuickBooks reconnect required for portalId=${args.portalId} (realm=${args.intuitRealmId}). Caller must disable sync and notify the IU.`,
    )
    this.name = 'QBReconnectRequiredError'
    this.portalId = args.portalId
    this.intuitRealmId = args.intuitRealmId
    this.intiatedBy = args.intiatedBy
  }
}

function extractTokens(
  row: QBPortalConnectionSelectSchemaType,
): IntuitAPITokensType {
  return {
    accessToken: row.accessToken,
    refreshToken: row.refreshToken,
    intuitRealmId: row.intuitRealmId,
    incomeAccountRef: row.incomeAccountRef,
    expenseAccountRef: row.expenseAccountRef,
    assetAccountRef: row.assetAccountRef,
    serviceItemRef: row.serviceItemRef,
    clientFeeRef: row.clientFeeRef,
    bankAccountRef: row.bankAccountRef,
  }
}

function isTokenFresh(row: {
  tokenSetTime: Date | null
  expiresIn: number
}): boolean {
  if (!row.tokenSetTime) return false
  const expiresAt = dayjs(row.tokenSetTime).add(row.expiresIn, 'seconds')
  return dayjs().add(REFRESH_BUFFER_SECONDS, 'seconds').isBefore(expiresAt)
}

/**
 * Returns a usable QBO token set for `portalId`.
 *
 * Refreshes the access token proactively if it's within `REFRESH_BUFFER_SECONDS`
 * of expiry; otherwise returns the stored values untouched. Cross-process
 * refresh races are resolved inside `getRefreshedQbTokenInfo` — one worker
 * wins, others detect via `tokenSetTime` and use the winner's tokens.
 *
 * @throws {@link QBReconnectRequiredError} if the refresh token has been revoked.
 */
export async function getValidQbTokens(
  portalId: string,
): Promise<IntuitAPITokensType> {
  const row = await getPortalConnection(portalId)
  if (!row) {
    throw new Error(
      `getValidQbTokens | Portal connection not found for portalId: ${portalId}`,
    )
  }
  if (isTokenFresh(row)) return extractTokens(row)
  // Pass the row we just read so `getRefreshedQbTokenInfo` can use it as the
  // race-detection baseline. Without this, a concurrent worker winning a
  // refresh between our two reads would advance `tokenSetTime`, causing our
  // inner read to capture the winner's value as `startingTokenSetTime` — and
  // a subsequent `invalid_grant` response would be misdiagnosed as revocation.
  return getRefreshedQbTokenInfo(portalId, row)
}

/**
 * Refreshes the QBO access token via Intuit, persists the result to
 * `qb_portal_connections`, and returns the new token set.
 *
 * Handles two failure modes on `invalid_grant`:
 *   1. Race — another worker refreshed first (DB `tokenSetTime` advanced).
 *      Returns the winner's tokens from the re-read; no error thrown.
 *   2. Genuine revocation — throws `QBReconnectRequiredError` without mutating
 *      DB state. The caller owns the disable-sync + notify-IU side effects.
 */
export async function getRefreshedQbTokenInfo(
  portalId: string,
  prefetchedConnection?: QBPortalConnectionSelectSchemaType,
): Promise<IntuitAPITokensType> {
  // Prefer the pre-fetched row (from the caller's own freshness check) so the
  // race-detection baseline matches what the caller observed. Fall back to a
  // fresh read for callers that invoke this directly (e.g. the
  // rename-qb-account CLI, which unconditionally refreshes every iteration).
  const portalConnection =
    prefetchedConnection ?? (await getPortalConnection(portalId))
  if (!portalConnection) {
    throw new Error(
      `getRefreshedQbTokenInfo | Portal connection not found for portalId: ${portalId}`,
    )
  }

  const startingTokenSetTime = portalConnection.tokenSetTime
  const { refreshToken, intuitRealmId, intiatedBy } = portalConnection

  CustomLogger.info({
    message: `getRefreshedQbTokenInfo | Refreshing access token for portalId: ${portalId}`,
  })

  let refreshedToken
  try {
    refreshedToken =
      await Intuit.getInstance().getRefreshedQBToken(refreshToken)
  } catch (error: unknown) {
    if (
      isIntuitOAuthError(error) &&
      error.error === OAuthErrorCodes.INVALID_GRANT
    ) {
      return handleInvalidGrant({
        portalId,
        intuitRealmId,
        intiatedBy,
        startingTokenSetTime,
      })
    }
    throw error
  }

  const updatedTokens: IntuitAPITokensType = {
    accessToken: refreshedToken.access_token,
    refreshToken: refreshedToken.refresh_token,
    intuitRealmId,
    incomeAccountRef: portalConnection.incomeAccountRef,
    expenseAccountRef: portalConnection.expenseAccountRef,
    assetAccountRef: portalConnection.assetAccountRef,
    serviceItemRef: portalConnection.serviceItemRef,
    clientFeeRef: portalConnection.clientFeeRef,
    bankAccountRef: portalConnection.bankAccountRef,
  }

  const updatedPayload: QBPortalConnectionUpdateSchemaType = {
    accessToken: updatedTokens.accessToken,
    refreshToken: updatedTokens.refreshToken,
    expiresIn: refreshedToken.expires_in,
    XRefreshTokenExpiresIn: refreshedToken.x_refresh_token_expires_in,
    tokenSetTime: dayjs().toDate(),
    updatedAt: dayjs().toDate(),
  }

  const [updated] = await db
    .update(QBPortalConnection)
    .set(updatedPayload)
    .where(
      and(
        eq(QBPortalConnection.intuitRealmId, intuitRealmId),
        eq(QBPortalConnection.portalId, portalId),
      ),
    )
    .returning({ id: QBPortalConnection.id })

  if (!updated) {
    throw new Error(
      `getRefreshedQbTokenInfo | No row updated for portalId=${portalId}, realmId=${intuitRealmId}`,
    )
  }

  return updatedTokens
}

async function handleInvalidGrant(args: {
  portalId: string
  intuitRealmId: string
  intiatedBy: string | null
  startingTokenSetTime: Date | null
}): Promise<IntuitAPITokensType> {
  // A concurrent refresh from another worker would have consumed the same
  // refresh token before us and advanced `tokenSetTime` in the DB. Re-read
  // and compare — if it moved, we raced and should use the winner's tokens.
  const current = await getPortalConnection(args.portalId)
  const raced =
    current?.tokenSetTime &&
    (!args.startingTokenSetTime ||
      dayjs(current.tokenSetTime).isAfter(args.startingTokenSetTime))

  if (raced && current) {
    CustomLogger.info({
      message: `getRefreshedQbTokenInfo | invalid_grant resolved by concurrent refresh for portalId: ${args.portalId}`,
    })
    return extractTokens(current)
  }

  // Genuine revocation. Don't mutate state here — signal only. Callers with
  // a Copilot user context disable `syncFlag` and notify IUs together so
  // those side effects stay paired. Callers without that context may swallow.
  CustomLogger.error({
    message: `getRefreshedQbTokenInfo | Refresh token revoked for portalId: ${args.portalId}.`,
  })

  throw new QBReconnectRequiredError({
    portalId: args.portalId,
    intuitRealmId: args.intuitRealmId,
    intiatedBy: args.intiatedBy,
  })
}
