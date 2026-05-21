import { FailedRecordCategoryType } from '@/app/api/core/types/log'
import { AccountErrorCodes } from '@/constant/intuitErrorCode'
import { refreshTokenExpireMessage } from '@/utils/auth'
import { ErrorMessageAndCode } from '@/utils/error'

const MAPPING_NOT_FOUND_PATTERN =
  /(?:mapping|customer|product|invoice|item|price).*not found/i

export function getCategory(errorWithCode?: ErrorMessageAndCode) {
  if (!errorWithCode) return FailedRecordCategoryType.OTHERS
  if (errorWithCode.code && AccountErrorCodes.includes(errorWithCode.code)) {
    return FailedRecordCategoryType.ACCOUNT
  }
  if (errorWithCode.message === refreshTokenExpireMessage) {
    return FailedRecordCategoryType.AUTH
  }
  if (errorWithCode.code === 429) {
    return FailedRecordCategoryType.RATE_LIMIT
  }
  if (errorWithCode.isValidationError) {
    return FailedRecordCategoryType.VALIDATION
  }
  if (errorWithCode.source === 'intuit') {
    return FailedRecordCategoryType.QB_API_ERROR
  }
  if (MAPPING_NOT_FOUND_PATTERN.test(errorWithCode.message)) {
    return FailedRecordCategoryType.MAPPING_NOT_FOUND
  }
  return FailedRecordCategoryType.OTHERS
}

// AUTH (refresh token dead) is terminal — retrying without a reconnect
// guarantees another failure. ACCOUNT (QBO subscription suspended) stays
// retryable so the cron's next sweep picks it up once the customer
// renews their subscription; MAX_ATTEMPTS bounds the retry waste.
export function getShouldRetryForCategory(
  errorWithCode?: ErrorMessageAndCode,
): boolean {
  const category = getCategory(errorWithCode)
  return category !== FailedRecordCategoryType.AUTH
}
