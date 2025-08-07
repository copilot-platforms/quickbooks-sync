import APIError from '@/app/api/core/exceptions/api'
import User from '@/app/api/core/models/User.model'
import { withRetry } from '@/app/api/core/utils/withRetry'
import { SyncService } from '@/app/api/quickbooks/sync/sync.service'
import { copilotAPIKey } from '@/config'
import { getAllPortalConnections } from '@/db/service/token.service'
import { CopilotAPI } from '@/utils/copilotAPI'
import { encodePayload } from '@/utils/crypto'

export default class CronService {
  private async _scheduleSinglePortal(workspaceId: string) {
    const payload = {
      workspaceId,
    }
    const token = encodePayload(copilotAPIKey, payload)

    // check if token is valid or not
    const copilot = new CopilotAPI(token)
    const tokenPayload = await copilot.getTokenPayload()
    console.info({ copilotApiCronToken: token, tokenPayload })
    if (!tokenPayload) throw new APIError(500, 'Encoded token is not valid') // this should trigger p-retry and re-run the function

    const user = new User(token, tokenPayload)
    const syncService = new SyncService(user)
    return await syncService.syncFailedRecords()
  }

  async rerunFailedSync() {
    const portalConnections = await getAllPortalConnections()

    if (portalConnections?.length === 0) {
      console.info('No portal connections found')
      return
    }

    await Promise.all(
      portalConnections.map(async (connection) => {
        if (connection.setting?.syncFlag && connection.setting?.isEnabled) {
          await this.scheduleSinglePortal(connection.portalId)
        }
      }),
    )
  }

  private wrapWithRetry<Args extends unknown[], R>(
    fn: (...args: Args) => Promise<R>,
  ): (...args: Args) => Promise<R> {
    return (...args: Args): Promise<R> => withRetry(fn.bind(this), args)
  }

  scheduleSinglePortal = this.wrapWithRetry(this._scheduleSinglePortal)
}
