export enum EntityType {
  INVOICE = 'invoice',
  PRODUCT = 'product',
  PAYMENT = 'payment',
  PAYOUT = 'payout',
}

export enum LogStatus {
  SUCCESS = 'success',
  FAILED = 'failed',
  INFO = 'info',
  PENDING = 'pending',
}

export enum EventType {
  CREATED = 'created',
  UPDATED = 'updated',
  PAID = 'paid',
  VOIDED = 'voided',
  DELETED = 'deleted',
  SUCCEEDED = 'succeeded',
  MAPPED = 'mapped',
  UNMAPPED = 'unmapped',
  SETTLED = 'settled',
}

/**
 * Category Type
 * auth: related to authentication like refresh token expiry
 * account: related to QBO account subscription expiry
 * others: other category that can include genuine errors
 */
export enum FailedRecordCategoryType {
  AUTH = 'auth',
  ACCOUNT = 'account',
  RATE_LIMIT = 'rate_limit',
  VALIDATION = 'validation',
  QB_API_ERROR = 'qb_api_error',
  MAPPING_NOT_FOUND = 'mapping_not_found',
  OTHERS = 'others',
}
