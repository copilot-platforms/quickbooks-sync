import authenticate from '@/app/api/core/utils/authenticate'
import { NextRequest, NextResponse } from 'next/server'
import httpStatus from 'http-status'
import { AccountService } from '@/app/api/quickbooks/accounts/accounts.service'
import { TokenService } from '@/app/api/quickbooks/token/token.service'
import { AccountRefsUpdateSchema } from '@/type/common'
import { QBPortalConnectionSelectSchema } from '@/db/schema/qbPortalConnections'

// Explicit allowlist of what is safe to return — anything else (especially
// token/secret fields) is dropped. Adding a new column to QBPortalConnection
// does NOT widen this surface unless the column is added here too.
const SafePortalConnectionSchema = QBPortalConnectionSelectSchema.pick({
  id: true,
  portalId: true,
  incomeAccountRef: true,
  expenseAccountRef: true,
  assetAccountRef: true,
})

export async function listAccounts(req: NextRequest) {
  const user = await authenticate(req)
  const service = new AccountService(user)
  const data = await service.listAccountsForProductMapping()
  return NextResponse.json(data)
}

export async function updateAccountRefs(req: NextRequest) {
  const user = await authenticate(req)
  const body = await req.json()
  const payload = AccountRefsUpdateSchema.parse(body)

  const service = new TokenService(user)
  const conn = await service.updateAccountRefs(payload)

  const safe = SafePortalConnectionSchema.parse(conn)

  return NextResponse.json(
    { portalConnection: safe },
    { status: httpStatus.OK },
  )
}
