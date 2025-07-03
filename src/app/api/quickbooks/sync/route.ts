import authenticate from '@/app/api/core/utils/authenticate'
import { SyncService } from '@/app/api/quickbooks/sync/sync.service'
import { NextRequest, NextResponse } from 'next/server'

export const GET = async (req: NextRequest) => {
  const user = await authenticate(req)
  const syncService = new SyncService(user)
  await syncService.syncFailedRecords()
  return NextResponse.json({ success: true })
}
