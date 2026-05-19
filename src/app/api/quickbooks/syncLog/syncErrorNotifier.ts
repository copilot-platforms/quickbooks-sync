import { BaseService } from '@/app/api/core/services/base.service'
import { EntityType, LogStatus } from '@/app/api/core/types/log'
import {
  NotificationActions,
  NotificationContext,
} from '@/app/api/core/types/notification'
import { NotificationService } from '@/app/api/notification/notification.service'
import { UserActionableErrorCodes } from '@/constant/intuitErrorCode'
import { QBSyncLogSelectSchemaType } from '@/db/schema/qbSyncLogs'
import { getPortalConnection } from '@/db/service/token.service'

/**
 * Looks up the user-actionable notification action for a given QBO error code.
 * Returns null when the code is empty, unknown, or refers to a transient/auth
 * error handled elsewhere (429, 5xx, invalid_grant, etc.).
 */
export function getActionForErrorCode(
  errorCode: string | null | undefined,
): NotificationActions | null {
  if (!errorCode) return null
  return UserActionableErrorCodes[errorCode] ?? null
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

    const context: NotificationContext = {
      entityType: log.entityType,
      eventType: log.eventType,
      entityKey: getEntityKey(log),
      invoiceNumber: log.invoiceNumber ?? undefined,
      customerName: log.customerName ?? undefined,
      productName: log.productName ?? undefined,
      qbItemName: log.qbItemName ?? undefined,
      errorMessage: log.errorMessage ?? undefined,
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
