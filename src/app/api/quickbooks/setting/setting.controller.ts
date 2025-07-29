import authenticate from '@/app/api/core/utils/authenticate'
import { SettingService } from '@/app/api/quickbooks/setting/setting.service'
import { QBSetting, QBSettingsUpdateSchemaType } from '@/db/schema/qbSettings'
import { eq } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import httpStatus from 'http-status'
import { SettingRequestSchema, SettingType } from '@/type/common'

export async function getSettings(req: NextRequest) {
  const user = await authenticate(req)
  const settingService = new SettingService(user)
  const type = req.nextUrl.searchParams.get('type')
  const parsedType = z.nativeEnum(SettingType).safeParse(type)
  const returningFields: (keyof typeof QBSetting)[] = []

  if (parsedType.success) {
    // return attributes as per the type. If type not provided, return all attributes
    returningFields.push(
      'id',
      'initialInvoiceSettingMap',
      'initialProductSettingMap',
    )
    if (parsedType.data === SettingType.INVOICE)
      returningFields.push('absorbedFeeFlag', 'useCompanyNameFlag')
    if (parsedType.data === SettingType.PRODUCT)
      returningFields.push('createNewProductFlag')
  }
  const setting = await settingService.getOneByPortalId(returningFields)
  return NextResponse.json({ setting })
}

export async function updateSettings(req: NextRequest) {
  const user = await authenticate(req)
  const body = await req.json()

  const parsedBody = SettingRequestSchema.parse(body)
  const settingService = new SettingService(user)
  const type = req.nextUrl.searchParams.get('type')

  const parsedType = z.nativeEnum(SettingType).parse(type)

  const payload: QBSettingsUpdateSchemaType = {
    ...parsedBody,
  }
  if (parsedType === SettingType.INVOICE) {
    payload.initialInvoiceSettingMap = true
  } else {
    payload.initialProductSettingMap = true
  }
  const setting = await settingService.updateQBSettings(
    payload,
    eq(QBSetting.portalId, user.workspaceId),
  )
  return NextResponse.json({ setting }, { status: httpStatus.CREATED })
}
