import { AuthStatus } from '@/app/api/core/types/auth'
import {
  NotificationActions,
  NotificationContext,
} from '@/app/api/core/types/notification'

// Appended to bodies where the failure was caused by a manual edit in
// QuickBooks. Communicates that (a) the record will be visible as failed in
// the sync history until the conflict is resolved, and (b) manual edits to
// synced records can disrupt the sync flow.
const MANUAL_EDIT_NOTE =
  'Until the conflict is resolved, this record will show as failed in the sync history. Manual edits to synced records in QuickBooks can disrupt the sync flow.'

// Variant for the 5010 invoice case where the scheduled retry cannot recover
// (e.g. the invoice was voided directly in QuickBooks). The record stays
// FAILED indefinitely.
const FINAL_FAILURE_NOTE =
  'This record will remain marked as failed in the sync history. Manual edits to synced records in QuickBooks can disrupt the sync flow.'

interface InProductNotificationDetail {
  title: string
  body: string
  ctaParams?: Record<string, unknown>
}

interface EmailNotificationDetail {
  title: string
  subject: string
  header: string
  body: string
  ctaParams?: Record<string, string>
}

// Defaults shared by every sync-failure email entry. AUTH_RECONNECT and
// QB_SUBSCRIPTION_INVALID override these; the other 9 actions match verbatim
// and so omit the corresponding fields below.
const DEFAULT_EMAIL_TITLE = 'QuickBooks sync failed'
const DEFAULT_EMAIL_HEADER = 'A QuickBooks sync failed'

type BodyBuilder = (ref: string, ctx?: NotificationContext) => string

interface NotificationActionEntry {
  title: string
  body: BodyBuilder
  emailTitle?: string
  emailSubject: string
  emailHeader?: string
  emailBody: BodyBuilder
  ctaParams?: Record<string, string>
}

/**
 * Maps a (entityType, eventType) pair to a short noun phrase like
 * "invoice creation" or "product update". Used to tell IUs *which* sync
 * action triggered the failure (e.g. 5010 during invoice void vs invoice
 * paid). Falls back to '' when either dimension is missing.
 *
 * Special-cased pairs describe what we *actually do* in QuickBooks rather
 * than the raw Copilot event name — e.g. payment.succeeded triggers a
 * Fee/Purchase creation, so we render it as "fee create" instead of
 * "payment completion".
 */
const describeAction = (entityType?: string, eventType?: string): string => {
  if (!entityType || !eventType) return ''
  if (entityType === 'payment' && eventType === 'succeeded') {
    return 'invoice fees creation'
  }
  const eventNoun =
    (
      {
        created: 'creation',
        updated: 'update',
        paid: 'payment',
        voided: 'void',
        deleted: 'deletion',
        succeeded: 'completion',
        mapped: 'mapping',
        unmapped: 'unmapping',
      } as Record<string, string>
    )[eventType] ?? eventType
  return `${entityType} ${eventNoun}`
}

/**
 * Builds the parenthetical reference clause for a sync-failure notification
 * body, e.g. " (during invoice void, ref INV-9)". Returns '' when called
 * without context (AUTH_RECONNECT path).
 *
 * Sync-failure ctx normally carries entityType + eventType (NOT NULL on
 * qb_sync_logs) and one of the id fields. The segment guards below defend
 * against future callers passing partial context — a missing dimension
 * drops its segment rather than rendering "(during , ref X)".
 */
const buildEntityReference = (ctx?: NotificationContext): string => {
  if (!ctx) return ''
  const action = describeAction(ctx.entityType, ctx.eventType)
  const id =
    ctx.invoiceNumber ||
    ctx.qbItemName ||
    ctx.productName ||
    ctx.customerName ||
    ctx.entityKey
  const segments: string[] = []
  if (action) segments.push(`during ${action}`)
  if (id) segments.push(`ref ${id}`)
  if (segments.length === 0) return ''
  return ` (${segments.join(', ')})`
}

/**
 * Per-action notification copy for both delivery channels. In-product and
 * email strings are stored verbatim (not derived from each other) — they have
 * been independently approved by product and differ in subtle, deliberate
 * ways (e.g. in-product uses semicolons + "the next scheduled retry will pick
 * it up"; email uses periods + "(within a few hours) automatically").
 *
 * The keys here also drive `IU_RECIPIENT_ACTIONS` in notification.service.ts
 * — adding an entry automatically opts the action into IU dispatch.
 */
export const NotificationCopy: Record<
  NotificationActions,
  NotificationActionEntry
> = {
  [NotificationActions.AUTH_RECONNECT]: {
    title: 'QuickBooks Sync has disconnected',
    body: () =>
      'Your QuickBooks Sync encountered an error and has stopped syncing. Please reconnect to avoid any disruptions.',
    emailTitle: 'Reconnect QuickBooks',
    emailSubject: 'Your QuickBooks Sync has disconnected',
    emailHeader: 'QuickBooks Sync has disconnected',
    emailBody: () =>
      'Your QuickBooks integration encountered an error and has stopped syncing. Please reconnect to avoid any disruptions.',
    // TODO: CTA params not working for email
    ctaParams: { type: AuthStatus.RECONNECT },
  },

  [NotificationActions.QB_DUPLICATE_DOC_NUMBER]: {
    title: 'QuickBooks sync failed: duplicate document number',
    body: (ref) =>
      `A sync failed${ref} because another invoice in QuickBooks already uses this document number. This often happens when "Custom transaction numbers" is enabled and the same number was reused, or an invoice with that number was created manually in QuickBooks. Change the document number on the conflicting invoice in QuickBooks; we re-attempt failed syncs every few hours, so the next run should pick it up. ${MANUAL_EDIT_NOTE}`,
    emailSubject: 'QuickBooks sync failed: duplicate document number',
    emailBody: (ref) =>
      `A sync failed${ref} because another invoice in QuickBooks already uses this document number. This often happens when "Custom transaction numbers" is enabled in QuickBooks and the same number was reused, or an invoice with that number was created manually. Change the document number on the conflicting invoice in QuickBooks. We re-attempt failed syncs automatically every few hours, so the next run should pick it up — no further action needed in this app. ${MANUAL_EDIT_NOTE}`,
  },

  // 6240 lives in two QBO namespaces: Items have their own list, while
  // Customer/Vendor/Employee share one. The body branches on entityType
  // because the fix is namespace-specific.
  [NotificationActions.QB_DUPLICATE_NAME]: {
    title: 'QuickBooks sync failed: name already in use',
    body: (ref, ctx) =>
      ctx?.entityType === 'product'
        ? `A sync failed${ref} because the item's name conflicts with an existing item in QuickBooks. This typically happens when an item with the same name was added in QuickBooks. Rename the conflicting item in QuickBooks; the next scheduled retry will pick it up. ${MANUAL_EDIT_NOTE}`
        : `A sync failed${ref} because the customer's display name conflicts with an existing Customer, Vendor, or Employee in QuickBooks. We automatically try up to 20 numbered variations of the name to avoid this, so this notification means every variation is taken — typically because a Vendor or Employee was added in QuickBooks with the same base name. Rename the conflicting Vendor or Employee in QuickBooks; the next scheduled retry will pick it up. ${MANUAL_EDIT_NOTE}`,
    emailSubject: 'QuickBooks sync failed: name already in use',
    emailBody: (ref, ctx) =>
      ctx?.entityType === 'product'
        ? `A sync failed${ref} because the item's name conflicts with an existing item in QuickBooks. This typically happens when an item with the same name was added in QuickBooks. Rename the conflicting item in QuickBooks. The next scheduled retry (within a few hours) will pick it up automatically. ${MANUAL_EDIT_NOTE}`
        : `A sync failed${ref} because the customer's display name conflicts with an existing Customer, Vendor, or Employee in QuickBooks. We automatically try up to 20 numbered variations of the name to work around this, so this email means every variation is taken — typically because a Vendor or Employee was added in QuickBooks with the same base name. Rename the conflicting Vendor or Employee in QuickBooks. The next scheduled retry (within a few hours) will pick it up automatically. ${MANUAL_EDIT_NOTE}`,
  },

  [NotificationActions.QB_CLOSED_PERIOD]: {
    title: 'QuickBooks sync failed: accounting period is closed',
    body: (ref) =>
      `A sync failed${ref} because the transaction date falls in a closed accounting period. This usually happens after a fiscal year close or when a closing date was set in Settings → Account and Settings → Advanced in QuickBooks. Reopen the period or move the closing date in QuickBooks; the next scheduled retry will pick it up. ${MANUAL_EDIT_NOTE}`,
    emailSubject: 'QuickBooks sync failed: accounting period is closed',
    emailBody: (ref) =>
      `A sync failed${ref} because the transaction date falls in a closed accounting period in QuickBooks. This usually happens after a fiscal year close or when a closing date was set in Settings → Account and Settings → Advanced. Reopen the period or move the closing date in QuickBooks. The next scheduled retry (within a few hours) will pick it up automatically. ${MANUAL_EDIT_NOTE}`,
  },

  [NotificationActions.QB_DEPOSITED_TXN_LOCKED]: {
    title: 'QuickBooks sync failed: transaction is deposited',
    body: (ref) =>
      `A sync failed${ref} because the transaction has been added to a bank deposit in QuickBooks, which locks it from edits. This usually happens when the payment was recorded as part of a deposit in QuickBooks. Remove the transaction from the deposit (or undo the deposit) in QuickBooks; the next scheduled retry will pick it up. ${MANUAL_EDIT_NOTE}`,
    emailSubject: 'QuickBooks sync failed: transaction is deposited',
    emailBody: (ref) =>
      `A sync failed${ref} because the transaction has been added to a bank deposit in QuickBooks, which locks it from edits. This usually happens when the payment was recorded as part of a deposit in QuickBooks. Remove the transaction from the deposit (or undo the deposit) in QuickBooks. The next scheduled retry (within a few hours) will pick it up automatically. ${MANUAL_EDIT_NOTE}`,
  },

  [NotificationActions.QB_INACTIVE_REFERENCE]: {
    title: 'QuickBooks sync failed: referenced record is inactive',
    body: (ref) =>
      `A sync failed${ref} because a referenced QuickBooks record (a customer, item, or account) was deleted or marked inactive. This often happens when someone cleaned up records in QuickBooks while a related transaction was still in flight, or when a service mapping points to a deleted item. Reactivate the record in QuickBooks, or update the relevant entry under Service Mapping in this app's settings; the next scheduled retry will pick it up. ${MANUAL_EDIT_NOTE}`,
    emailSubject: 'QuickBooks sync failed: referenced record is inactive',
    emailBody: (ref) =>
      `A sync failed${ref} because a referenced QuickBooks record (a customer, item, or account) was deleted or marked inactive. This often happens when records are cleaned up in QuickBooks while a related transaction is still in flight, or when a Service Mapping in this app points to an item that no longer exists. Reactivate the record in QuickBooks, or update the entry under Service Mapping in this app's settings. The next scheduled retry (within a few hours) will pick it up automatically. ${MANUAL_EDIT_NOTE}`,
  },

  [NotificationActions.QB_SUBSCRIPTION_INVALID]: {
    title: 'QuickBooks subscription issue is blocking sync',
    body: (ref) =>
      `Syncs are failing${ref} because your QuickBooks subscription is suspended, expired, or has a billing issue. QuickBooks blocks all write operations until the subscription is active again, so every sync attempt for this portal will fail until billing is resolved. Update your QuickBooks subscription; we'll automatically resume syncing on the next scheduled retry.`,
    emailTitle: 'QuickBooks subscription issue',
    emailSubject: 'QuickBooks subscription issue is blocking sync',
    emailHeader: 'QuickBooks subscription issue is blocking sync',
    emailBody: (ref) =>
      `Syncs are failing${ref} because your QuickBooks subscription is suspended, expired, or has a billing issue. QuickBooks blocks all write operations until the subscription is active again, so every sync attempt for this portal will fail until billing is resolved. Update your QuickBooks subscription. We'll automatically resume syncing on the next scheduled retry — no action needed in this app.`,
  },

  [NotificationActions.QB_VALIDATION_FAILED]: {
    title: 'QuickBooks sync failed: validation error',
    body: (ref) =>
      `QuickBooks rejected a sync${ref} because the data didn't pass one of its business rules. This often happens when required setup is missing — for example a default income account on an item, tax setup, or a customer's billing address. Download the sync history from the app menu to see the exact error message, then resolve it in QuickBooks; the next scheduled retry will pick it up.`,
    emailSubject: 'QuickBooks sync failed: validation error',
    emailBody: (ref) =>
      `QuickBooks rejected a sync${ref} because the data didn't pass one of its business rules. This often happens when required setup is missing in QuickBooks — for example a default income account on an item, tax setup, or a customer's billing address. To see the exact error, download the sync history CSV from the app menu in this app and check the error_message column. Once you've resolved the issue in QuickBooks, the next scheduled retry (within a few hours) will pick it up automatically.`,
  },

  // Suppression in SyncErrorNotifier guarantees we only reach this branch
  // for invoice 5010 — product/customer 5010 auto-recovers via syncToken
  // refresh on the next retry and is not surfaced to IUs.
  //
  // The body intentionally avoids prescribing a specific fix (e.g. "undo the
  // void"): 5010 only tells us our cached SyncToken is behind, not *what*
  // changed in QuickBooks. The change could be an edit, void, deletion, or
  // anything else.
  [NotificationActions.QB_STALE_OBJECT]: {
    title: 'QuickBooks sync failed: record was edited elsewhere',
    body: (ref) =>
      `A sync failed${ref} because the invoice in QuickBooks has changed since we last read it — it may have been edited, voided, deleted, or otherwise modified directly in QuickBooks. The scheduled retry cannot recover this automatically because our pending change targets a version that is no longer current. Open the invoice in QuickBooks to confirm its current state matches what you expect. ${FINAL_FAILURE_NOTE}`,
    emailSubject: 'QuickBooks sync failed: record was edited elsewhere',
    emailBody: (ref) =>
      `A sync failed${ref} because the invoice in QuickBooks has changed since we last read it — it may have been edited, voided, deleted, or otherwise modified directly in QuickBooks. The scheduled retry cannot recover this automatically, because our pending change targets a version that is no longer current. Open the invoice in QuickBooks to confirm its current state matches what you expect. ${FINAL_FAILURE_NOTE}`,
  },

  // 620 only tells us QuickBooks refused the link — not which related record
  // is the problem or what happened to it. Body avoids prescribing a specific
  // fix and conditions the retry promise on the conflict actually being
  // resolvable.
  [NotificationActions.QB_TXN_LINK_FAILED]: {
    title: 'QuickBooks sync failed: transaction cannot be linked',
    body: (ref) =>
      `A sync failed${ref} because QuickBooks could not link the transaction to a related record. The linked customer, invoice, or payment may have been updated, voided, deleted, or otherwise made unlinkable in QuickBooks. Review the related records in QuickBooks to identify the conflict; if you can restore the linked record to a usable state (for example by reactivating it), the next scheduled retry will pick it up. ${MANUAL_EDIT_NOTE}`,
    emailSubject: 'QuickBooks sync failed: transaction cannot be linked',
    emailBody: (ref) =>
      `A sync failed${ref} because QuickBooks could not link the transaction to a related record. The linked customer, invoice, or payment may have been updated, voided, deleted, or otherwise made unlinkable in QuickBooks. Review the related records in QuickBooks to identify the conflict. If you can restore the linked record to a usable state (for example by reactivating it), the next scheduled retry (within a few hours) will pick it up automatically. ${MANUAL_EDIT_NOTE}`,
  },

  [NotificationActions.QB_ITEM_INCOME_ACCOUNT_MISSING]: {
    title: 'QuickBooks sync failed: item is missing an income account',
    body: (ref) =>
      `A sync failed${ref} because a QuickBooks item has no income account assigned. This usually happens when the item was created in QuickBooks without an income account, or the account was removed afterwards. Open Products and Services in QuickBooks, edit the item, and set its income account; the next scheduled retry will pick it up.`,
    emailSubject: 'QuickBooks sync failed: item is missing an income account',
    emailBody: (ref) =>
      `A sync failed${ref} because a QuickBooks item has no income account assigned. This usually happens when the item was created in QuickBooks without an income account, or the account was removed afterwards. Open Products and Services in QuickBooks, edit the item, and set its income account. The next scheduled retry (within a few hours) will pick it up automatically.`,
  },
}

export const getInProductNotificationDetail = (
  action: NotificationActions,
  ctx?: NotificationContext,
): InProductNotificationDetail => {
  const entry = NotificationCopy[action]
  const ref = buildEntityReference(ctx)
  return {
    title: entry.title,
    body: entry.body(ref, ctx),
    ...(entry.ctaParams && { ctaParams: entry.ctaParams }),
  }
}

export const getIEmailNotificationDetail = (
  action: NotificationActions,
  ctx?: NotificationContext,
): EmailNotificationDetail => {
  const entry = NotificationCopy[action]
  const ref = buildEntityReference(ctx)
  return {
    title: entry.emailTitle ?? DEFAULT_EMAIL_TITLE,
    subject: entry.emailSubject,
    header: entry.emailHeader ?? DEFAULT_EMAIL_HEADER,
    body: entry.emailBody(ref, ctx),
    ...(entry.ctaParams && { ctaParams: entry.ctaParams }),
  }
}
