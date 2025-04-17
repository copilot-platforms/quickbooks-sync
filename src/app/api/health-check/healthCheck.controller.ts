import { healthCheckService } from '@/app/api/health-check/healthCheck.service'
import { NextResponse } from 'next/server'

export const healthCheck = async () => {
  let dbConnection: boolean = false
  try {
    console.time('healthcheck')
    const hcService = new healthCheckService()
    dbConnection = await hcService.getApiHealthCheck()
    console.timeEnd('healthcheck')
  } catch (err) {
    console.error(err)
  }

  return NextResponse.json({
    message: 'Copilot QuickBooks Sync API is rolling 🔥',
    dbConnection,
  })
}
