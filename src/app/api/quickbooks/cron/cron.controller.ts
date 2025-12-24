import APIError from '@/app/api/core/exceptions/api'
import { cronSecret } from '@/config'
import { NextRequest, NextResponse } from 'next/server'
import { processResyncForFailedRecords } from '@/trigger/resyncFailedRecords'

export const processFailedSync = async (request: NextRequest) => {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${cronSecret}`) {
    throw new APIError(401, 'Unauthorized')
  }
  processResyncForFailedRecords.trigger()
  return NextResponse.json({
    success: true,
    message: 'Logs are successfully added to resync queue.',
  })
}
