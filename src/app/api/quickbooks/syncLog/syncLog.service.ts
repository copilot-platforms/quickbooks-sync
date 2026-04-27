import { BaseService } from '@/app/api/core/services/base.service'
import {
  EntityType,
  EventType,
  FailedRecordCategoryType,
  LogStatus,
} from '@/app/api/core/types/log'
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
import dayjs from 'dayjs'
import { and, eq, isNull, lt } from 'drizzle-orm'
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
    return log
  }

  /**
   * Creates the sync log
   */
  async updateQBSyncLog(
    payload: QBSyncLogUpdateSchemaType,
    conditions: WhereClause,
  ): Promise<QBSyncLogSelectSchemaType> {
    const parsedPayload = QBSyncLogUpdateSchema.parse(payload)
    const [log] = await this.db
      .update(QBSyncLog)
      .set(parsedPayload)
      .where(conditions)
      .returning()

    console.info('SyncLogService#updateQBSyncLog | Sync log updated')
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
      await this.updateQBSyncLog(payload, eq(QBSyncLog.id, existingLog.id))
    } else {
      await this.createQBSyncLog(payload)
    }
  }

  /**
   * Atomic-ish idempotency claim for webhook entry. Returns `claimed: true` if
   * we successfully wrote a new PENDING row for this (portal, copilot, entity,
   * event) tuple, or `claimed: false` if a row already exists for that tuple
   * — meaning another delivery has handled or is handling it.
   *
   * Without a unique constraint on `qb_sync_logs` (descoped due to historical
   * production duplicates), the read-then-insert has a sub-millisecond TOCTOU
   * window. In practice this closes the dominant `invoice.created` +
   * `invoice.updated` race because the existing `sleep(10000)` already
   * serialises those events.
   *
   * Stale claims (PENDING older than `STALE_PENDING_THRESHOLD_MINUTES`) are
   * recovered by `flipStalePendingToFailed` during the next resync cycle.
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
    const existing = await this.getOneByCopilotIdAndEventType({
      copilotId,
      eventType,
      entityType,
    })
    if (existing) {
      return { claimed: false }
    }

    await this.createQBSyncLog({
      portalId: this.user.workspaceId,
      copilotId,
      entityType,
      eventType,
      status: LogStatus.PENDING,
      invoiceNumber,
    })
    return { claimed: true }
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
        errorMessage: 'Stale PENDING claim — worker did not finalise in time',
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
        error_message: log.errorMessage,
      }
    })

    return json2csv(data)
  }
}
