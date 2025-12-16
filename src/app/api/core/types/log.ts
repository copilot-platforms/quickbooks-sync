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

export enum CategoryType {
  AUTH = 'auth',
  ACCOUNT = 'account',
  OTHERS = 'others',
}
