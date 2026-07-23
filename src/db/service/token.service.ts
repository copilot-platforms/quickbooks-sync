'use server'
import APIError from '@/app/api/core/exceptions/api'
import { db } from '@/db'
import {
  PortalConnectionWithSettingType,
  QBPortalConnection,
  QBPortalConnectionSelectSchemaType,
} from '@/db/schema/qbPortalConnections'
import { QBSetting, QBSettingsSelectSchemaType } from '@/db/schema/qbSettings'
import { WorkspaceResponse } from '@/type/common'
import { CopilotAPI } from '@/utils/copilotAPI'
import { IntuitAPITokensType } from '@/utils/intuitAPI'
import { and, asc, eq, isNotNull, isNull, sql } from 'drizzle-orm'
import httpStatus from 'http-status'

export const getPortalConnection = async (
  portalId: string,
): Promise<PortalConnectionWithSettingType | null> => {
  const portalSync = await db.query.QBPortalConnection.findFirst({
    where: (QBPortalConnection, { eq }) =>
      and(
        isNull(QBPortalConnection.deletedAt),
        eq(QBPortalConnection.portalId, portalId),
      ),
    with: {
      setting: true,
    },
  })

  return portalSync || null
}

export const getAllActivePortalConnections = async (): Promise<
  PortalConnectionWithSettingType[]
> => {
  const portals = await db.query.QBPortalConnection.findMany({
    where: (QBPortalConnection) =>
      and(
        isNull(QBPortalConnection.deletedAt),
        eq(QBPortalConnection.isSuspended, false), // ignore suspended portals
      ),
    with: {
      setting: true,
    },
  })

  return portals
}

/**
 * Returns portals whose refresh token will expire within `daysRemaining` days
 * AND have `qb_settings.sync_flag = true`, ordered by the soonest-to-expire
 * first and capped at `limit`. Powers the daily refresh-token cron.
 *
 * Inner-joined on `qb_settings` so portals without a settings row (sync never
 * configured) are skipped. Filtering is done in SQL — not JS — so the LIMIT
 * is meaningful: we always tackle the most-urgent rows first when the backlog
 * exceeds capacity.
 */
export const getPortalsWithExpiringRefreshTokens = async (
  daysRemaining: number,
  limit: number,
): Promise<QBPortalConnectionSelectSchemaType[]> => {
  const rows = await db
    .select({ portal: QBPortalConnection })
    .from(QBPortalConnection)
    .innerJoin(QBSetting, eq(QBSetting.portalId, QBPortalConnection.portalId))
    .where(
      and(
        isNull(QBPortalConnection.deletedAt),
        // `isSuspended` intentionally not filtered: that column is dead code
        // today (no path writes `true`). Revisit if/when suspension is wired
        // up, alongside the matching change in `getAllActivePortalConnections`.
        isNotNull(QBPortalConnection.tokenSetTime),
        eq(QBSetting.syncFlag, true),
        sql`${QBPortalConnection.tokenSetTime} + (${QBPortalConnection.XRefreshTokenExpiresIn} || ' seconds')::interval
            < now() + (${daysRemaining} || ' days')::interval`,
        // Lower bound: already-expired tokens get `invalid_grant` from
        // Intuit and never recover — they need an IU reconnect. Filtering
        // here (not in the loop) keeps them invisible to ORDER BY and
        // LIMIT so live portals aren't starved. See docs/qb-refresh-token-cron.md.
        sql`${QBPortalConnection.tokenSetTime} + (${QBPortalConnection.XRefreshTokenExpiresIn} || ' seconds')::interval
            > now()`,
      ),
    )
    .orderBy(asc(QBPortalConnection.tokenSetTime))
    .limit(limit)

  return rows.map((r) => r.portal)
}

export const getPortalSettings = async (
  portalId: string,
): Promise<QBSettingsSelectSchemaType | null> => {
  const portalSync = await db.query.QBSetting.findFirst({
    where: (QBSetting, { eq }) =>
      and(eq(QBSetting.portalId, portalId), eq(QBSetting.syncFlag, true)),
  })

  return portalSync || null
}

export const getWorkspaceInfo = async (
  token: string,
): Promise<WorkspaceResponse> => {
  return await new CopilotAPI(token).getWorkspace()
}

export const getPortalTokens = async (
  portalId: string,
): Promise<IntuitAPITokensType> => {
  const portalConnection = await getPortalConnection(portalId)
  if (!portalConnection)
    throw new APIError(httpStatus.NOT_FOUND, 'Portal connection not found')

  return {
    accessToken: portalConnection.accessToken,
    refreshToken: portalConnection.refreshToken,
    intuitRealmId: portalConnection.intuitRealmId,
    incomeAccountRef: portalConnection.incomeAccountRef,
    expenseAccountRef: portalConnection.expenseAccountRef,
    assetAccountRef: portalConnection.assetAccountRef,
    serviceItemRef: portalConnection.serviceItemRef,
    clientFeeRef: portalConnection.clientFeeRef,
    bankAccountRef: portalConnection.bankAccountRef,
  }
}
