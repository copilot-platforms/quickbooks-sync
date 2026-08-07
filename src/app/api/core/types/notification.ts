export enum NotificationActions {
  AUTH_RECONNECT = 'auth_reconnect',
  QB_DUPLICATE_NAME = 'qb_duplicate_name',
  QB_CLOSED_PERIOD = 'qb_closed_period',
  QB_DEPOSITED_TXN_LOCKED = 'qb_deposited_txn_locked',
  QB_INACTIVE_REFERENCE = 'qb_inactive_reference',
  QB_SUBSCRIPTION_INVALID = 'qb_subscription_invalid',
  QB_VALIDATION_FAILED = 'qb_validation_failed',
  QB_STALE_OBJECT = 'qb_stale_object',
  QB_TXN_LINK_FAILED = 'qb_txn_link_failed',
  QB_ITEM_INCOME_ACCOUNT_MISSING = 'qb_item_income_account_missing',
  QB_INVALID_ACCOUNT_TYPE = 'qb_invalid_account_type',
  QB_PAYOUT_MIXED_INTENT = 'qb_payout_mixed_intent',
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
  // Nullable string fields mirror their nullable qb_sync_logs columns, so
  // callers can pass log values directly. Consumers treat null/undefined alike.
  invoiceNumber?: string | null
  // Comma-joined invoice numbers for a multi-invoice failure (mixed payout),
  // where the single invoiceNumber above can't hold them all.
  invoiceNumbers?: string | null
  // Subset of invoiceNumbers whose absorbed fee is already recorded in QBO, so a
  // mixed-payout body can tell IUs which fees not to record a second time.
  invoiceNumbersWithFee?: string | null
  customerName?: string | null
  productName?: string | null
  qbItemName?: string | null
  errorMessage?: string | null
}
