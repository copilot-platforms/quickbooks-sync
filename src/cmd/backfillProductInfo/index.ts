import APIError from '@/app/api/core/exceptions/api'
import User from '@/app/api/core/models/User.model'
import { BackfillProductInfoService } from '@/cmd/backfillProductInfo/backfillProductInfo.service'
import { copilotAPIKey } from '@/config'
import { PortalConnectionWithSettingType } from '@/db/schema/qbPortalConnections'
import { getAllActivePortalConnections } from '@/db/service/token.service'
import { AssemblyTokenPayload } from '@/utils/assemblyTokenPayload'
import { encodePayload } from '@/utils/crypto'
import CustomLogger from '@/utils/logger'

/**
 * This script is used to backfill product info in our mapping table
 */

// command to run the script: `yarn run cmd:backfill-product-info`
;(async function run() {
  try {
    console.info('BackfillProductInfo#initiateProcess')
    const activeConnections = await getAllActivePortalConnections()

    if (!activeConnections.length) {
      console.info('No active connection found')
      return
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

    console.info('\n Backfilled product info to mapping table successfully 🎉')
    process.exit(0)
  } catch (error) {
    console.error(error)
    process.exit(1)
  }
})()

async function initiateProcess(connection: PortalConnectionWithSettingType) {
  // generate token for the portal
  console.info('Generating token for the portal')
  const payload = {
    workspaceId: connection.portalId,
  }
  const token = encodePayload(copilotAPIKey, payload)

  const tokenPayload = await new AssemblyTokenPayload().getTokenPayload(token)
  CustomLogger.info({
    obj: { copilotApiCronToken: token, tokenPayload },
    message:
      'backfillProductInfo#initiateProcess | Copilot API token and payload',
  })
  if (!tokenPayload) throw new APIError(500, 'Encoded token is not valid') // this should trigger p-retry and re-run the function

  const user = new User(token, tokenPayload)
  const syncMissedService = new BackfillProductInfoService(user)
  await syncMissedService.backfillProductInfoForPortal()
}
