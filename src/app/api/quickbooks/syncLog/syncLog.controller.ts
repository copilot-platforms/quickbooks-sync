import authenticate from '@/app/api/core/utils/authenticate'
import { NextRequest, NextResponse } from 'next/server'
import { SyncLogService } from '@/app/api/quickbooks/syncLog/syncLog.service'

export const getLatestSyncSuccessLog = async (req: NextRequest) => {
  const user = await authenticate(req)
  const logService = new SyncLogService(user)
  const data = await logService.getLatestSyncSuccessLog()
  return NextResponse.json({ data })
}

export const downloadSyncLogs = async (req: NextRequest) => {
  const user = await authenticate(req)
  const syncLogService = new SyncLogService(user)
  const csvData = await syncLogService.prepareSyncLogsForDownload()
  return new NextResponse(csvData, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': 'attachment; filename=sync_logs.csv',
    },
  })
}
