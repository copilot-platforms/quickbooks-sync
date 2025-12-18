import { FailedRecordCategoryType } from '@/app/api/core/types/log'
import { AccountErrorCodes } from '@/constant/intuitErrorCode'
import { refreshTokenExpireMessage } from '@/utils/auth'
import { ErrorMessageAndCode } from '@/utils/error'

export function getCategory(errorWithCode?: ErrorMessageAndCode) {
  if (!errorWithCode) return FailedRecordCategoryType.OTHERS
  if (errorWithCode.code && AccountErrorCodes.includes(errorWithCode.code)) {
    return FailedRecordCategoryType.ACCOUNT
  }
  if (errorWithCode.message === refreshTokenExpireMessage) {
    return FailedRecordCategoryType.AUTH
  }
  return FailedRecordCategoryType.OTHERS
}

export function getDeletedAtForAuthAccountCategoryLog(
  errorWithCode?: ErrorMessageAndCode,
) {
  const category = getCategory(errorWithCode)
  if (category !== FailedRecordCategoryType.OTHERS) return new Date()
  return
}
