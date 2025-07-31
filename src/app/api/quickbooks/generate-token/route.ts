import { copilotAPIKey } from '@/config'
import { encodePayload } from '@/utils/crypto'
import { NextRequest, NextResponse } from 'next/server'

export const GET = (req: NextRequest) => {
  const payload = {
    internalUserId: 'cb48fd1b-cf05-44f2-b6d0-417ae8b68165',
    workspaceId: 'MeVreyArM',
  }
  const token = encodePayload(copilotAPIKey, payload)
  return NextResponse.json({ token })
}
