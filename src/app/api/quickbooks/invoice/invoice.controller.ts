import authenticate from '@/app/api/core/utils/authenticate'
import { SettingService } from '@/app/api/quickbooks/setting/setting.service'
import { QBSetting } from '@/db/schema/qbSettings'
import { InvoiceSettingSchema } from '@/type/common'
import { eq } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'
import httpStatus from 'http-status'

export async function changeInvoiceSettings(req: NextRequest) {
  const user = await authenticate(req)
  const body = await req.json()

  const parsedBody = InvoiceSettingSchema.parse(body)
  const settingService = new SettingService(user)
  const portal = await settingService.updateQBSettings(
    parsedBody,
    eq(QBSetting.portalId, user.workspaceId),
  )
  return NextResponse.json({ portal }, { status: httpStatus.CREATED })
}
