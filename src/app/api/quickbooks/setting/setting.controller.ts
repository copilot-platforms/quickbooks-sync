import authenticate from '@/app/api/core/utils/authenticate'
import { SettingService } from '@/app/api/quickbooks/setting/setting.service'
import { TokenService } from '@/app/api/quickbooks/token/token.service'
import { db } from '@/db'
import { QBPortalConnection } from '@/db/schema/qbPortalConnections'
import { QBSetting } from '@/db/schema/qbSettings'
import { getPortalConnection } from '@/db/service/token.service'
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
      returningFields.push(
        'absorbedFeeFlag',
        'bankDepositFeeFlag',
        'useCompanyNameFlag',
      )
    if (parsedType.data === SettingType.PRODUCT)
      returningFields.push('createNewProductFlag')
  }
  const setting = await settingService.getOneByPortalId(returningFields)

  let bankAccountRef: string | null = null
  if (parsedType.success && parsedType.data === SettingType.INVOICE) {
    const portalConnection = await getPortalConnection(user.workspaceId)
    bankAccountRef = portalConnection?.bankAccountRef || null
  }

  return NextResponse.json({ setting, bankAccountRef })
}

export async function updateSettings(req: NextRequest) {
  const user = await authenticate(req)
  const body = await req.json()

  const settingService = new SettingService(user)
  const type = req.nextUrl.searchParams.get('type')

  const parsedType = z.nativeEnum(SettingType).parse(type)

  const parsed = SettingRequestSchema.parse(body)
  const { bankAccountRef, ...settingFields } = parsed

  const payload = {
    ...settingFields,
    ...(parsedType === SettingType.INVOICE
      ? { initialInvoiceSettingMap: true }
      : { initialProductSettingMap: true }),
  }

  const writeBankAccountRef =
    parsedType === SettingType.INVOICE && typeof bankAccountRef !== 'undefined'

  const setting = await db.transaction(async (tx) => {
    settingService.setTransaction(tx)
    try {
      const result = await settingService.updateQBSettings(
        payload,
        eq(QBSetting.portalId, user.workspaceId),
      )
      if (writeBankAccountRef) {
        const tokenService = new TokenService(user)
        tokenService.setTransaction(tx)
        try {
          await tokenService.updateQBPortalConnection(
            { bankAccountRef: bankAccountRef || null },
            eq(QBPortalConnection.portalId, user.workspaceId),
          )
        } finally {
          tokenService.unsetTransaction()
        }
      }
      return result
    } finally {
      settingService.unsetTransaction()
    }
  })

  return NextResponse.json({ setting }, { status: httpStatus.CREATED })
}
