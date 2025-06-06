import authenticate from '@/app/api/core/utils/authenticate'
import { NextRequest, NextResponse } from 'next/server'
import { LogService } from '@/app/api/quickbooks/log/log.service'

export const getLatestSuccessLog = async (req: NextRequest) => {
  const user = await authenticate(req)
  const logService = new LogService(user)
  const data = await logService.getLatestSuccessLog()
  return NextResponse.json({ data })
}
