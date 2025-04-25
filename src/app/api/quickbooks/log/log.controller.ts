import authenticate from '@/app/api/core/utils/authenticate'
import { LogService } from '@/app/api/quickbooks/log/log.service'
import { QBConnectionLogCreateSchema } from '@/db/schema/qbConnectionLogs'
import { NextRequest, NextResponse } from 'next/server'

export const storeQbConnectionLog = async (req: NextRequest) => {
  const user = await authenticate(req)
  const body = await req.json()
  const parsedBody = QBConnectionLogCreateSchema.parse(body)
  const logService = new LogService(user)
  const connectionLog = await logService.storeConnectionLog(parsedBody)
  return NextResponse.json({ connectionLog })
}
