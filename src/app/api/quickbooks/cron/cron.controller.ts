import APIError from '@/app/api/core/exceptions/api'
import { cronSecret } from '@/config'
import { NextRequest, NextResponse } from 'next/server'
import CronService from '@/app/api/quickbooks/cron/cron.service'

export const processFailedSync = async (request: NextRequest) => {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${cronSecret}`) {
    throw new APIError(401, 'Unauthorized')
  }
  const cronService = new CronService()
  await cronService.rerunFailedSync()
  return NextResponse.json({ success: true })
}
