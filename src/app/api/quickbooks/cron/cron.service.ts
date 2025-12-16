import APIError from '@/app/api/core/exceptions/api'
import User, { QBConnectionProperties } from '@/app/api/core/models/User.model'
import { LogStatus } from '@/app/api/core/types/log'
import { withRetry } from '@/app/api/core/utils/withRetry'
import { SyncService } from '@/app/api/quickbooks/sync/sync.service'
import { copilotAPIKey } from '@/config'
import { db } from '@/db'
import { QBSyncLog } from '@/db/schema/qbSyncLogs'
import { getAllPortalConnections } from '@/db/service/token.service'
import { CopilotAPI } from '@/utils/copilotAPI'
import { encodePayload } from '@/utils/crypto'
import CustomLogger from '@/utils/logger'
import dayjs from 'dayjs'
import { and, eq, lt } from 'drizzle-orm'

export default class CronService {
  private async _scheduleSinglePortal(
    workspaceId: string,
    qbConnectionTokens: QBConnectionProperties,
  ) {
    const payload = {
      workspaceId,
    }
    const token = encodePayload(copilotAPIKey, payload)

    // check if token is valid or not
    const copilot = new CopilotAPI(token)
    const tokenPayload = await copilot.getTokenPayload()
    CustomLogger.info({
      obj: { copilotApiCronToken: token, tokenPayload },
      message:
        'CronService#_scheduleSinglePortal | Copilot API token and payload',
    })
    if (!tokenPayload) throw new APIError(500, 'Encoded token is not valid') // this should trigger p-retry and re-run the function

    const user = new User(token, tokenPayload)
    user.qbConnection = qbConnectionTokens
    const syncService = new SyncService(user)

    // TODO: add max_attempts
    const { suspended } = await syncService.checkAndSuspendAccount()
    if (suspended) return
    return await syncService.syncFailedRecords()
  }

  async rerunFailedSync() {
    const portalConnections = await getAllPortalConnections()

    if (portalConnections?.length === 0) {
      console.info('No portal connections found')
      return
    }
    // await this.softDeleteOldFailedLogs()

    // synchronously done because creating multiple instance of Copilot SDK simultaneously, is causing an issue.
    for (const connection of portalConnections) {
      if (connection.setting?.syncFlag && connection.setting?.isEnabled) {
        const qbConnectionTokens = {
          clientFeeRef: connection.clientFeeRef,
          serviceItemRef: connection.serviceItemRef,
        }
        await this.scheduleSinglePortal(connection.portalId, qbConnectionTokens)
      }
    }
  }

  private async softDeleteOldFailedLogs() {
    console.info(
      'CronService#softDeleteOldFailedLogs. Implementing soft delete for older failed logs ...',
    )

    // soft delete records older than a month
    const dateThreshold = dayjs().subtract(1, 'month').toDate()

    await db
      .update(QBSyncLog)
      .set({
        deletedAt: new Date(),
      })
      .where(
        and(
          lt(QBSyncLog.createdAt, dateThreshold),
          eq(QBSyncLog.status, LogStatus.FAILED),
        ),
      )
  }

  private wrapWithRetry<Args extends unknown[], R>(
    fn: (...args: Args) => Promise<R>,
  ): (...args: Args) => Promise<R> {
    return (...args: Args): Promise<R> => withRetry(fn.bind(this), args)
  }

  scheduleSinglePortal = this.wrapWithRetry(this._scheduleSinglePortal)
}
