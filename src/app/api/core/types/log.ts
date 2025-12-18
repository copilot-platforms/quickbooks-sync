export enum EntityType {
  INVOICE = 'invoice',
  PRODUCT = 'product',
  PAYMENT = 'payment',
}

export enum LogStatus {
  SUCCESS = 'success',
  FAILED = 'failed',
  INFO = 'info',
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
  OTHERS = 'others',
}
