import authenticate from '@/app/api/core/utils/authenticate'
import { SettingService } from '@/app/api/quickbooks/setting/setting.service'
import { QBSetting } from '@/db/schema/qbSettings'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

enum SettingType {
  INVOICE = 'invoice',
  PRODUCT = 'product',
}

export async function getSettings(req: NextRequest) {
  const user = await authenticate(req)
  const settingService = new SettingService(user)
  const type = req.nextUrl.searchParams.get('type')
  const parsedType = z.nativeEnum(SettingType).safeParse(type)
  const returnigFields: (keyof typeof QBSetting)[] = []

  if (parsedType.success) {
    // return attributes as per the type. If type not provided, return all attributes
    returnigFields.push('id')
    if (parsedType.data === SettingType.INVOICE)
      returnigFields.push('absorbedFeeFlag', 'useCompanyNameFlag')
    if (parsedType.data === SettingType.PRODUCT)
      returnigFields.push('createNewProductFlag', 'createInvoiceItemFlag')
  }
  const setting = await settingService.getOneByPortalId(returnigFields)
  return NextResponse.json({ setting })
}
