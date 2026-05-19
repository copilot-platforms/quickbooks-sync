import { NotificationActions } from '@/app/api/core/types/notification'

// Doc: https://developer.intuit.com/app/developer/qbo/docs/develop/troubleshooting/error-codes
export const QBOErrorCodes = {
  OBJECT_NOT_FOUND: 610,
  TXN_LINK_FAILED: 620,
  ITEM_INCOME_ACCOUNT_MISSING: 2390,
  INVALID_REFERENCE_ID: 2500,
  STALE_OBJECT: 5010,
  BUSINESS_VALIDATION: 6000,
  DUPLICATE_DOC_NUMBER: 6140,
  ACCOUNT_SUSPENDED: 6190,
  CLOSED_PERIOD: 6210,
  DUPLICATE_NAME_EXISTS: 6240, // customer/vendor/employee name collision
  INVALID_ACCOUNT_TYPE: 6430,
  DEPOSITED_TXN_LOCKED: 6540,
} as const

export type QBOErrorCode = (typeof QBOErrorCodes)[keyof typeof QBOErrorCodes]

export const AccountErrorCodes: readonly number[] = [
  QBOErrorCodes.ACCOUNT_SUSPENDED,
  QBOErrorCodes.BUSINESS_VALIDATION,
]

export const OAuthErrorCodes = {
  INVALID_GRANT: 'invalid_grant',
} as const

/**
 * Maps QBO error codes to the IU notification action they should trigger.
 *
 * Scope: only codes that require a human to fix data/settings in QuickBooks.
 * Transient (429, 5xx) and auth (120, 401/invalid_grant) errors are handled
 * elsewhere — 429/5xx by retry, auth by AUTH_RECONNECT.
 *
 * Keyed by string because intuit Fault.Error.code arrives as a string in
 * payloads and we persist it as varchar in qb_sync_logs.error_code.
 */
export const UserActionableErrorCodes: Record<string, NotificationActions> = {
  // QBOErrorCodes.DUPLICATE_DOC_NUMBER intentionally omitted — see
  // InvoiceService#webhookInvoiceCreated suffix-retry (OUT-3754).
  [QBOErrorCodes.OBJECT_NOT_FOUND]: NotificationActions.QB_INACTIVE_REFERENCE,
  [QBOErrorCodes.TXN_LINK_FAILED]: NotificationActions.QB_TXN_LINK_FAILED,
  [QBOErrorCodes.ITEM_INCOME_ACCOUNT_MISSING]:
    NotificationActions.QB_ITEM_INCOME_ACCOUNT_MISSING,
  [QBOErrorCodes.INVALID_REFERENCE_ID]:
    NotificationActions.QB_INACTIVE_REFERENCE,
  [QBOErrorCodes.STALE_OBJECT]: NotificationActions.QB_STALE_OBJECT,
  [QBOErrorCodes.BUSINESS_VALIDATION]: NotificationActions.QB_VALIDATION_FAILED,
  [QBOErrorCodes.ACCOUNT_SUSPENDED]:
    NotificationActions.QB_SUBSCRIPTION_INVALID,
  [QBOErrorCodes.CLOSED_PERIOD]: NotificationActions.QB_CLOSED_PERIOD,
  [QBOErrorCodes.DUPLICATE_NAME_EXISTS]: NotificationActions.QB_DUPLICATE_NAME,
  [QBOErrorCodes.INVALID_ACCOUNT_TYPE]:
    NotificationActions.QB_INVALID_ACCOUNT_TYPE,
  [QBOErrorCodes.DEPOSITED_TXN_LOCKED]:
    NotificationActions.QB_DEPOSITED_TXN_LOCKED,
}
