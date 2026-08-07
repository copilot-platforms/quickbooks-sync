import { BaseService } from '@/app/api/core/services/base.service'
import { EntityType, LogStatus } from '@/app/api/core/types/log'
import {
  NotificationActions,
  NotificationContext,
} from '@/app/api/core/types/notification'
import { NotificationService } from '@/app/api/notification/notification.service'
import {
  AppActionableErrorCodes,
  MIXED_INTENT_INVOICE_DELIMITER,
  UserActionableErrorCodes,
} from '@/constant/intuitErrorCode'
import { QBSyncLogSelectSchemaType } from '@/db/schema/qbSyncLogs'
import { getPortalConnection } from '@/db/service/token.service'
import { getInvoiceNumbersWithRecordedFee } from '@/db/service/syncLog.service'
import CustomLogger from '@/utils/logger'

/**
 * Looks up the user-actionable notification action for a given QBO error code.
 * Returns null when the code is empty, unknown, or refers to a transient/auth
 * error handled elsewhere (429, 5xx, invalid_grant, etc.).
 */
export function getActionForErrorCode(
  errorCode: string | null | undefined,
): NotificationActions | null {
  if (!errorCode) return null
  return (
    UserActionableErrorCodes[errorCode] ??
    AppActionableErrorCodes[errorCode] ??
    null
  )
}

/**
 * Picks the strongest available identifier for the offending QBO entity so the
 * notification body can reference a concrete record (invoice number, item, etc).
 */
export function getEntityKey(log: QBSyncLogSelectSchemaType): string {
  return (
    log.quickbooksId ||
    log.invoiceNumber ||
    log.qbItemName ||
    log.copilotPriceId ||
    log.copilotId ||
    ''
  )
}

export class SyncErrorNotifier extends BaseService {
  /**
   * Dispatches an IU notification for a freshly written FAILED sync log row
   * when its errorCode is in the user-actionable registry. One sync_log insert
   * = one notification — natural dedup comes from sync_log being created once
   * per failed entity.
   *
   * Errors here are caller-suppressed; a notification failure must not undo
   * the sync log write.
   */
  async notify(log: QBSyncLogSelectSchemaType): Promise<void> {
    if (log.status !== LogStatus.FAILED) return

    const action = getActionForErrorCode(log.errorCode)
    if (!action) return

    // PRODUCT 5010 auto-recovers via updateProductSyncToken on the next
    // cron tick. INVOICE/PAYMENT have no equivalent refresh, so their
    // 5010s stay user-actionable.
    if (
      action === NotificationActions.QB_STALE_OBJECT &&
      log.entityType === EntityType.PRODUCT
    ) {
      return
    }

    // Mixed-payout rows stash the affected invoices in `remark`; surface them,
    // then flag which already have a recorded fee to warn against double-booking.
    const affectedInvoiceNumbers =
      action === NotificationActions.QB_PAYOUT_MIXED_INTENT ? log.remark : null
    let invoiceNumbersWithFee: string | undefined
    if (affectedInvoiceNumbers) {
      try {
        const affected = affectedInvoiceNumbers
          .split(MIXED_INTENT_INVOICE_DELIMITER)
          .filter(Boolean)
        const withFee = await getInvoiceNumbersWithRecordedFee(
          this.user.workspaceId,
          affected,
        )
        const recorded = affected.filter((invoiceNumber) =>
          withFee.has(invoiceNumber),
        )
        if (recorded.length)
          invoiceNumbersWithFee = recorded.join(MIXED_INTENT_INVOICE_DELIMITER)
      } catch (error) {
        // A lookup blip must still let the terminal payout notification through.
        CustomLogger.error({
          message:
            'SyncErrorNotifier | recorded-fee lookup failed; notifying without it',
          obj: error,
        })
      }
    }

    const context: NotificationContext = {
      entityType: log.entityType,
      eventType: log.eventType,
      entityKey: getEntityKey(log),
      invoiceNumber: log.invoiceNumber,
      customerName: log.customerName,
      productName: log.productName,
      qbItemName: log.qbItemName,
      errorMessage: log.errorMessage,
      invoiceNumbers: affectedInvoiceNumbers ?? undefined,
      invoiceNumbersWithFee,
    }
    const portal = await getPortalConnection(this.user.workspaceId)

    const notificationService = new NotificationService(this.user)
    // Webhook-driven failures have no calling IU. Empty senderId mirrors the
    // existing AUTH_RECONNECT pattern (auth.service.ts) where `error.intiatedBy
    // ?? ''` is passed to sendNotificationToIU.
    await notificationService.sendNotificationToIU(
      portal?.intiatedBy || '',
      action,
      context,
    )
  }
}
