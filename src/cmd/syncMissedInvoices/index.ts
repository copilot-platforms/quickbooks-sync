import APIError from '@/app/api/core/exceptions/api'
import User from '@/app/api/core/models/User.model'
import { SyncMissedInvoicesService } from '@/cmd/syncMissedInvoices/syncMissedInvoices.service'
import { copilotAPIKey } from '@/config'
import { PortalConnectionWithSettingType } from '@/db/schema/qbPortalConnections'
import { getAllActivePortalConnections } from '@/db/service/token.service'
import { getAssemblyTokenPayload } from '@/utils/assemblyTokenPayload'
import { encodePayload } from '@/utils/crypto'
import CustomLogger from '@/utils/logger'

/**
 * This script is used to sync missed invoices that have payment records but no invoice records in QBO.
 */

// command to run the script: `yarn run cmd:sync-missed-invoices`
;(async function run() {
  try {
    console.info('SyncMissedInvoices#run | Starting sync missed invoices')
    const activeConnections = await getAllActivePortalConnections()

    if (!activeConnections.length) {
      console.info('No active connection found')
      process.exit(0)
    }

    for (const connection of activeConnections) {
      if (!connection.setting?.syncFlag || !connection.setting?.isEnabled) {
        console.info(
          'Skipping connection: ' + JSON.stringify(connection.portalId),
        )
        continue
      }

      console.info(
        `\n\n\n ########### Processing for PORTAL: ${connection.portalId} #############`,
      )

      await initiateProcess(connection)
    }

    console.info('\n Sync missed invoices completed successfully')
    process.exit(0)
  } catch (error) {
    console.error(error)
    process.exit(1)
  }
})()

async function initiateProcess(connection: PortalConnectionWithSettingType) {
  console.info('Generating token for the portal')
  const payload = {
    workspaceId: connection.portalId,
  }
  const token = encodePayload(copilotAPIKey, payload)

  const tokenPayload = await getAssemblyTokenPayload(token)
  CustomLogger.info({
    obj: { copilotApiCronToken: token, tokenPayload },
    message:
      'syncMissedInvoices#initiateProcess | Copilot API token and payload',
  })
  if (!tokenPayload) throw new APIError(500, 'Encoded token is not valid')

  const user = new User(token, tokenPayload)
  const syncMissedService = new SyncMissedInvoicesService(user)
  await syncMissedService.syncMissedInvoicesForPortal()
}
