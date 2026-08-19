import APIError from '@/app/api/core/exceptions/api'
import User from '@/app/api/core/models/User.model'
import { SyncMissedProductsService } from '@/cmd/syncMissedProducts/syncMissedProducts.service'
import { copilotAPIKey } from '@/config'
import { PortalConnectionWithSettingType } from '@/db/schema/qbPortalConnections'
import { getAllActivePortalConnections } from '@/db/service/token.service'
import { getAssemblyTokenPayload } from '@/utils/assemblyTokenPayload'
import { encodePayload } from '@/utils/crypto'
import CustomLogger from '@/utils/logger'

/**
 * This script updates mapped products in QBO whose names were changed in Assembly
 * during a specific date window but were missed during regular sync.
 */

// command to run the script: `yarn run cmd:sync-missed-products`
;(async function run() {
  try {
    console.info('SyncMissedProducts#run | Starting sync missed products')
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

      if (!connection.setting.createNewProductFlag) {
        console.info(
          `Skipping connection: ${connection.portalId}. Create new product flag is false`,
        )
        continue
      }

      console.info(
        `\n\n\n ########### Processing for PORTAL: ${connection.portalId} #############`,
      )

      await initiateProcess(connection)
    }

    console.info('\n Sync missed products completed successfully')
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
      'syncMissedProducts#initiateProcess | Copilot API token and payload',
  })
  if (!tokenPayload) throw new APIError(500, 'Encoded token is not valid')

  const user = new User(token, tokenPayload)
  const syncMissedService = new SyncMissedProductsService(user)
  await syncMissedService.syncMissedProductsForPortal()
}
