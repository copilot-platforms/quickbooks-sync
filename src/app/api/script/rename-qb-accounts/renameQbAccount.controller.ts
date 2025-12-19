import authenticate from '@/app/api/core/utils/authenticate'
import { RenameQbAccountService } from '@/app/api/script/rename-qb-accounts/renameQbAccount.service'
import { NextRequest, NextResponse } from 'next/server'

export async function renameQbAccountName(req: NextRequest) {
  const user = await authenticate(req)

  // uncomment below code to rename QB accounts.
  // const renameQbAccountService = new RenameQbAccountService(user)
  // await renameQbAccountService.renameQbAccountName()
  return NextResponse.json({ message: 'Successfully renamed QB accounts' })
}
