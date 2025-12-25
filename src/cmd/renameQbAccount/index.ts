import { authenticateWithToken } from '@/app/api/core/utils/authenticate'
import { RenameQbAccountService } from '@/cmd/renameQbAccount/renameQbAccount.service'
import { z } from 'zod'

// command to run the script: `yarn run cmd:rename-qb-accounts -- --token={token}`
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

    const renameQbAccountService = new RenameQbAccountService(user)
    await renameQbAccountService.renameQbAccountName()

    console.info('\n Renamed QuickBooks accounts successfully 🎉')
    process.exit(1)
  } catch (error) {
    console.error(error)
    process.exit(1)
  }
})()
