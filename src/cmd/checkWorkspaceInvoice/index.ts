import { authenticateWithToken } from '@/app/api/core/utils/authenticate'
import { PortalImpactVerificationService } from '@/app/api/quickbooks/portalImpactVerification-temp/portalImpactVerification.service'
import { z } from 'zod'

/**
 * Command: `yarn run cmd:check-impact-on-workspace -- --token={token}`
 * Description: this script is created to check if the invoices are incorrectly synced in other workspaces.
 *  This workspace simply returns the list of the invoice numbers that might have been incorrectly synced.
 *  This script does not include the check of those invoice numbers with our sync log table (qb_sync_logs).
 *  Might have to manually check if there are any such invoices.
 * */
;(async function run() {
  try {
    const args = process.argv.slice(2)
    const tokenArg = args.find((a) => a.startsWith('--token='))
    const token = tokenArg?.split('=')[1]

    if (!token) {
      throw new Error('No token provided')
    }

    const tokenParsed = z.string().parse(token)
    const user = await authenticateWithToken(tokenParsed)

    const checkInvoiceService = new PortalImpactVerificationService(user)
    await checkInvoiceService.startProcess()

    console.info('\n Successfully checked invoices for impact 🎉')
    process.exit(1)
  } catch (error) {
    console.error(error)
    process.exit(1)
  }
})()
