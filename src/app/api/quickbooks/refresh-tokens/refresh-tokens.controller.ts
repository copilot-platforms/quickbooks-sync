import APIError from '@/app/api/core/exceptions/api'
import { cronSecret } from '@/config'
import { refreshExpiringTokens } from '@/app/api/quickbooks/refresh-tokens/refresh-tokens.service'
import { NextRequest, NextResponse } from 'next/server'

export const refreshExpiringTokensCron = async (request: NextRequest) => {
  // Explicit !cronSecret guard: when the env var is absent, the template
  // literal yields "Bearer undefined" and a request sending exactly that
  // string would otherwise pass. Fail loudly on misconfigured deployments.
  const authHeader = request.headers.get('authorization')
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    throw new APIError(401, 'Unauthorized')
  }

  const summary = await refreshExpiringTokens()
  return NextResponse.json({ success: true, ...summary })
}
