import { BaseService } from '@/app/api/core/services/base.service'
import {
  EntityType,
  EventType,
  FailedRecordCategoryType,
  LogStatus,
} from '@/app/api/core/types/log'
import { afterIfAvailable } from '@/app/api/core/utils/afterIfAvailable'
import { SyncErrorNotifier } from '@/app/api/quickbooks/syncLog/syncErrorNotifier'
import { ConnectionStatus } from '@/db/schema/qbConnectionLogs'
import {
  QBSyncLog,
  QBSyncLogCreateSchema,
  QBSyncLogCreateSchemaType,
  QBSyncLogSelectSchemaType,
  QBSyncLogUpdateSchema,
  QBSyncLogUpdateSchemaType,
  QBSyncLogWithEntityType,
} from '@/db/schema/qbSyncLogs'
import { WhereClause } from '@/type/common'
import { orderMap } from '@/utils/drizzle'
import CustomLogger from '@/utils/logger'
import dayjs from 'dayjs'
import { and, eq, isNull, lt, sql } from 'drizzle-orm'
import { captureException } from '@sentry/nextjs'
import { json2csv } from 'json-2-csv'

export const STALE_PENDING_THRESHOLD_MINUTES = 15

export type CustomSyncLogRecordType = {
  copilotId: string
  status: LogStatus
  eventType: EventType
  invoiceNumber: string
  amount: number
  createdAt: Date
  copilotPriceId: string | null
}

export type CustomSyncLogType = {
  entityType: EntityType
  eventType: EventType
  records: CustomSyncLogRecordType[]
}

export class SyncLogService extends BaseService {
  /**
   * Creates the sync log
   */
  async createQBSyncLog(
    payload: QBSyncLogCreateSchemaType,
  ): Promise<QBSyncLogSelectSchemaType> {
    const parsedInsertPayload = QBSyncLogCreateSchema.parse(payload)
    const [log] = await this.db
      .insert(QBSyncLog)
      .values(parsedInsertPayload)
      .returning()

    console.info('SyncLogService#createQBSyncLog | Sync log complete')
    this.scheduleFailureNotification(log)
    return log
  }

  /**
   * Schedules a sync-failure notification when a sync log row enters the
   * FAILED state. Errors are swallowed and reported to Sentry — a failed
   * notification must never propagate up and undo the sync log write.
   *
   * Hooked at two sites:
   *  - `createQBSyncLog`, for the rare path that writes a row directly as
   *    FAILED (legacy / non-claim flows).
   *  - `updateQBSyncLog`, for the dominant flow today: webhook entry inserts
   *    a PENDING claim, then a handler updates it to SUCCESS or FAILED.
   *
   * The update site passes `priorStatus` so we only fire on a *transition*
   * into FAILED. FAILED→FAILED retry replays don't re-page IUs.
   *
   * `flipStalePendingToFailed` writes FAILED rows without an `errorCode`;
   * those naturally no-op inside the notifier (`getActionForErrorCode(null)`
   * returns null) so we don't need to filter them here.
   */
  private scheduleFailureNotification(log: QBSyncLogSelectSchemaType): void {
    if (log.status !== LogStatus.FAILED) return

    // Defer dispatch until after the request scope (and any enclosing
    // transaction) commits, so the notification can never undo the sync log
    // write and never reads an uncommitted row. Errors are caller-suppressed
    // — surface to Sentry and continue.
    const user = this.user
    afterIfAvailable(async () => {
      try {
        const notifier = new SyncErrorNotifier(user)
        await notifier.notify(log)
      } catch (error) {
        CustomLogger.error({
          message:
            'SyncLogService#scheduleFailureNotification | Notifier failed',
          obj: { error, logId: log.id },
        })
        captureException(error, {
          tags: {
            key: 'syncFailureNotifierError',
            portalId: log.portalId,
            entityType: log.entityType,
            errorCode: log.errorCode ?? 'unknown',
          },
          extra: { logId: log.id, errorMessage: log.errorMessage },
        })
      }
    })
  }

  /**
   * Updates an existing sync log row. When the update transitions the row
   * INTO the FAILED state (i.e. its prior status was not FAILED), schedules
   * the IU sync-failure notification. Callers that already know the prior
   * status (e.g. `updateOrCreateQBSyncLog`) can pass it to skip the lookup;
   * otherwise we fetch it before applying the update so retry replays
   * (FAILED→FAILED) don't re-notify.
   */
  async updateQBSyncLog(
    payload: QBSyncLogUpdateSchemaType,
    conditions: WhereClause,
    priorStatus?: LogStatus,
  ): Promise<QBSyncLogSelectSchemaType> {
    const parsedPayload = QBSyncLogUpdateSchema.parse(payload)
    // Only consider notifying when this update is *actively* setting status to
    // FAILED. Partial updates that don't touch status (e.g. attempt counter
    // bumps in `checkAndUpdateAttempt`) leave a FAILED row FAILED — they are
    // not transitions and must not re-page IUs.
    const settingFailed = parsedPayload.status === LogStatus.FAILED

    if (priorStatus === undefined && settingFailed) {
      const existing = await this.db.query.QBSyncLog.findFirst({
        where: conditions,
        columns: { status: true },
      })
      priorStatus = existing?.status as LogStatus | undefined
    }

    const [log] = await this.db
      .update(QBSyncLog)
      .set(parsedPayload)
      .where(conditions)
      .returning()

    console.info('SyncLogService#updateQBSyncLog | Sync log updated')

    if (settingFailed && log && priorStatus !== LogStatus.FAILED) {
      this.scheduleFailureNotification(log)
    }

    return log
  }

  async getOneByCopilotIdAndEventType({
    copilotId,
    eventType,
    entityType,
  }: {
    copilotId: string
    eventType: EventType
    entityType: EntityType
  }) {
    // Excludes soft-deleted rows so updateOrCreateQBSyncLog can't accidentally
    // revive a previously soft-deleted log by updating it in place.
    const conditions = [
      eq(QBSyncLog.portalId, this.user.workspaceId),
      eq(QBSyncLog.copilotId, copilotId),
      eq(QBSyncLog.eventType, eventType),
      eq(QBSyncLog.entityType, entityType),
      isNull(QBSyncLog.deletedAt),
    ]

    const query = this.db.query.QBSyncLog.findFirst({
      where: and(...conditions),
    })
    return await query
  }

  async getOne(
    conditions: WhereClause,
    orderByDirection: 'asc' | 'desc' = 'desc',
  ) {
    const query = this.db.query.QBSyncLog.findFirst({
      where: conditions,
      orderBy: [orderMap[orderByDirection](QBSyncLog.createdAt)],
    })
    return await query
  }

  async updateOrCreateQBSyncLog(
    payload: QBSyncLogWithEntityType,
    conditions?: WhereClause,
  ) {
    let existingLog

    if (conditions) {
      // Exclude soft-deleted rows so a previously soft-deleted log isn't
      // revived by an in-place update.
      const sqlConditions = and(
        ...[conditions],
        eq(QBSyncLog.entityType, payload.entityType),
        isNull(QBSyncLog.deletedAt),
      ) as WhereClause
      existingLog = await this.getOne(sqlConditions)
    } else {
      existingLog = await this.getOneByCopilotIdAndEventType({
        copilotId: payload.copilotId,
        eventType: payload.eventType,
        entityType: payload.entityType,
      })
    }

    if (existingLog) {
      await this.updateQBSyncLog(
        payload,
        eq(QBSyncLog.id, existingLog.id),
        existingLog.status as LogStatus,
      )
    } else {
      await this.createQBSyncLog(payload)
    }
  }

  /**
   * Atomic idempotency claim via the partial unique index
   * `uq_qb_sync_logs_oneshot_active` (covers active invoice one-shot events
   * and all payment events). For rows in that slice, ON CONFLICT DO NOTHING
   * yields no row when another worker has already claimed the tuple, so
   * `claimed: false` is returned. For rows outside the slice
   * (INVOICE/UPDATED, PRODUCT, PRICE), the partial index does not apply and
   * INSERT always succeeds — preserving prior behavior for legitimate re-fires.
   * Stale PENDING claims are recovered by `flipStalePendingToFailed`.
   */
  async claimWebhookEvent({
    copilotId,
    entityType,
    eventType,
    invoiceNumber,
  }: {
    copilotId: string
    entityType: EntityType
    eventType: EventType
    invoiceNumber?: string
  }): Promise<{ claimed: boolean }> {
    const inserted = await this.db
      .insert(QBSyncLog)
      .values({
        portalId: this.user.workspaceId,
        copilotId,
        entityType,
        eventType,
        status: LogStatus.PENDING,
        invoiceNumber,
      })
      .onConflictDoNothing({
        target: [
          QBSyncLog.portalId,
          QBSyncLog.copilotId,
          QBSyncLog.entityType,
          QBSyncLog.eventType,
        ],
        where: sql`deleted_at IS NULL AND (
          (entity_type = 'invoice' AND event_type IN ('created','paid','voided','deleted'))
          OR (entity_type = 'payment' AND event_type = 'succeeded')
        )`,
      })
      .returning({ id: QBSyncLog.id })

    return { claimed: inserted.length > 0 }
  }

  /**
   * Flips PENDING claim rows older than `STALE_PENDING_THRESHOLD_MINUTES` to
   * FAILED so they get picked up by the existing failed-resync flow. Treats
   * a stale PENDING as evidence that the worker died before completing.
   */
  async flipStalePendingToFailed(): Promise<void> {
    const threshold = dayjs()
      .subtract(STALE_PENDING_THRESHOLD_MINUTES, 'minutes')
      .toDate()
    await this.db
      .update(QBSyncLog)
      .set({
        status: LogStatus.FAILED,
        category: FailedRecordCategoryType.OTHERS,
      })
      .where(
        and(
          eq(QBSyncLog.portalId, this.user.workspaceId),
          eq(QBSyncLog.status, LogStatus.PENDING),
          lt(QBSyncLog.createdAt, threshold),
          isNull(QBSyncLog.deletedAt),
        ),
      )
  }

  async deleteQBSyncLog(id: string): Promise<void> {
    await this.db
      .delete(QBSyncLog)
      .where(
        and(
          eq(QBSyncLog.portalId, this.user.workspaceId),
          eq(QBSyncLog.id, id),
        ),
      )
  }

  async softDeleteLogsByCopilotId(
    copilotId: string,
    entityType: EntityType,
    deletedAt: Date = new Date(),
  ): Promise<void> {
    await this.db
      .update(QBSyncLog)
      .set({ deletedAt })
      .where(
        and(
          eq(QBSyncLog.portalId, this.user.workspaceId),
          eq(QBSyncLog.copilotId, copilotId),
          eq(QBSyncLog.entityType, entityType),
          isNull(QBSyncLog.deletedAt),
        ),
      )
  }

  /**
   * Get all failed sync logs
   */
  async getAllFailedLogsForWorkspace(
    includeDeleted: boolean,
  ): Promise<QBSyncLogSelectSchemaType[] | []> {
    return await this.db.query.QBSyncLog.findMany({
      where: (logs, { eq, and }) =>
        and(
          eq(logs.portalId, this.user.workspaceId),
          eq(logs.status, LogStatus.FAILED),
          !includeDeleted ? isNull(logs.deletedAt) : undefined,
        ),
      orderBy: (logs, { asc }) => [asc(logs.createdAt)],
    })
  }

  async getLatestSyncSuccessLog(): Promise<Pick<
    QBSyncLogSelectSchemaType,
    'updatedAt'
  > | null> {
    let log = await this.db.query.QBSyncLog.findFirst({
      where: (logs, { eq, and }) =>
        and(
          eq(logs.portalId, this.user.workspaceId),
          eq(logs.status, LogStatus.SUCCESS),
        ),
      orderBy: (logs, { desc }) => [desc(logs.createdAt)], //ensures fetching of the latest success log
      columns: {
        updatedAt: true,
      },
    })

    //fetch latest successful connection log if no sync log found
    if (!log) {
      log = await this.db.query.QBConnectionLogs.findFirst({
        where: (logs, { eq, and }) =>
          and(
            eq(logs.portalId, this.user.workspaceId),
            eq(logs.connectionStatus, ConnectionStatus.SUCCESS),
          ),
        orderBy: (logs, { desc }) => [desc(logs.createdAt)],
        columns: {
          updatedAt: true,
        },
      })
    }
    return log || null
  }

  async prepareSyncLogsForDownload() {
    const logs = await this.db.query.QBSyncLog.findMany({
      where: eq(QBSyncLog.portalId, this.user.workspaceId),
    })

    const data = logs.map((log) => {
      return {
        sync_date: log.syncAt ? dayjs(log.syncAt).format('YYYY-MM-DD') : null,
        sync_time: log.syncAt ? dayjs(log.syncAt).format('HH:mm:ss') : null,
        event_type: log.eventType,
        status: log.status,
        entity_type: log.entityType,
        assembly_id: log.copilotId,
        quickbooks_id: log.quickbooksId,
        invoice_number: log.invoiceNumber,
        customer_name: log.customerName,
        customer_email: log.customerEmail,
        amount: log.amount ? parseFloat(log.amount) / 100 : null,
        tax_amount: log.taxAmount ? parseFloat(log.taxAmount) / 100 : null,
        fee_amount: log.feeAmount ? parseFloat(log.feeAmount) / 100 : null,
        product_name: log.productName,
        product_price: log.productPrice
          ? parseFloat(log.productPrice) / 100
          : null,
        qb_item_name: log.qbItemName,
        error_code: log.errorCode,
        error_message: log.errorMessage,
      }
    })

    return json2csv(data)
  }
}
