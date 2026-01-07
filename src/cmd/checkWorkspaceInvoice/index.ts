import { authenticateWithToken } from '@/app/api/core/utils/authenticate'
import { CheckPortalInvoiceService } from '@/app/api/quickbooks/portalImpactVerification-temp/checkPortalInvoice.service'
import { z } from 'zod'

// command to run the script: `yarn run cmd:check-impact-on-workspace -- --token={token}`
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

    const checkInvoiceService = new CheckPortalInvoiceService(user)
    await checkInvoiceService.startProcess()

    console.info('\n Check invoices successfully 🎉')
    process.exit(1)
  } catch (error) {
    console.error(error)
    process.exit(1)
  }
})()
