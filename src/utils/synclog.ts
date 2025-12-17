import { CategoryType } from '@/app/api/core/types/log'
import { AccountErrorCodes } from '@/constant/intuitErrorCode'
import { refreshTokenExpireMessage } from '@/utils/auth'
import { ErrorMessageAndCode } from '@/utils/error'

export function getCategory(errorWithCode?: ErrorMessageAndCode) {
  if (!errorWithCode) return CategoryType.OTHERS
  if (errorWithCode.code && AccountErrorCodes.includes(errorWithCode.code)) {
    return CategoryType.ACCOUNT
  }
  if (errorWithCode.message === refreshTokenExpireMessage) {
    return CategoryType.AUTH
  }
  return CategoryType.OTHERS
}

export function getDeletedAtForAuthAccountCategoryLog(
  errorWithCode?: ErrorMessageAndCode,
) {
  const category = getCategory(errorWithCode)
  if (category !== CategoryType.OTHERS) return new Date()
  return
}
