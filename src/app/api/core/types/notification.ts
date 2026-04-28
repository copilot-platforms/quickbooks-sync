export enum NotificationActions {
  AUTH_RECONNECT = 'auth_reconnect',
  QB_DUPLICATE_DOC_NUMBER = 'qb_duplicate_doc_number',
  QB_DUPLICATE_NAME = 'qb_duplicate_name',
  QB_CLOSED_PERIOD = 'qb_closed_period',
  QB_DEPOSITED_TXN_LOCKED = 'qb_deposited_txn_locked',
  QB_INACTIVE_REFERENCE = 'qb_inactive_reference',
  QB_SUBSCRIPTION_INVALID = 'qb_subscription_invalid',
  QB_VALIDATION_FAILED = 'qb_validation_failed',
  QB_STALE_OBJECT = 'qb_stale_object',
  QB_TXN_LINK_FAILED = 'qb_txn_link_failed',
  QB_ITEM_INCOME_ACCOUNT_MISSING = 'qb_item_income_account_missing',
}

/**
 * Optional context passed alongside a NotificationActions value when dispatching
 * a sync-failure notification. The notification helper uses these to interpolate
 * a tailored title/body (e.g. naming the offending invoice number or QB item).
 *
 * All fields are optional so callers (like AUTH_RECONNECT) can still dispatch
 * without context.
 */
export interface NotificationContext {
  entityType?: string
  eventType?: string
  entityKey?: string
  invoiceNumber?: string
  customerName?: string
  productName?: string
  qbItemName?: string
  errorMessage?: string
}
