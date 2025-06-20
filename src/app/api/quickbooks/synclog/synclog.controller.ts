import authenticate from '@/app/api/core/utils/authenticate'
import { NextRequest, NextResponse } from 'next/server'
import { SyncLogService } from '@/app/api/quickbooks/synclog/synclog.service'

export const getLatestSyncSuccessLog = async (req: NextRequest) => {
  const user = await authenticate(req)
  const logService = new SyncLogService(user)
  const data = await logService.getLatestSyncSuccessLog()
  return NextResponse.json({ data })
}
