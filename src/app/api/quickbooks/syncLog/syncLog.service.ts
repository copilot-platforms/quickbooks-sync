import { BaseService } from '@/app/api/core/services/base.service'
import { EntityType, EventType, LogStatus } from '@/app/api/core/types/log'
import { ConnectionStatus } from '@/db/schema/qbConnectionLogs'
import {
  QBSyncLog,
  QBSyncLogCreateSchema,
  QBSyncLogCreateSchemaType,
  QBSyncLogSelectSchemaType,
  QBSyncLogUpdateSchema,
  QBSyncLogUpdateSchemaType,
} from '@/db/schema/qbSyncLogs'
import { WhereClause } from '@/type/common'
import dayjs from 'dayjs'
import { and, eq, sql } from 'drizzle-orm'
import { json2csv } from 'json-2-csv'
import postgres from 'postgres'

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

  async getOneByCopilotIdAndEventType(
    copilotId: string,
    eventType?: EventType,
  ) {
    const conditions = [
      eq(QBSyncLog.portalId, this.user.workspaceId),
      eq(QBSyncLog.copilotId, copilotId),
      eventType ? eq(QBSyncLog.eventType, eventType) : undefined,
    ].filter(Boolean) // removes undefined

    const query = this.db.query.QBSyncLog.findFirst({
      where: and(...conditions),
    })
    return await query
  }

  async getOne(conditions: WhereClause) {
    const query = this.db.query.QBSyncLog.findFirst({
      where: conditions,
    })
    return await query
  }

  async updateOrCreateQBSyncLog(
    payload: QBSyncLogCreateSchemaType,
    conditions?: WhereClause,
  ) {
    let existingLog

    if (conditions) {
      existingLog = await this.getOne(conditions)
    } else {
      existingLog = await this.getOneByCopilotIdAndEventType(
        payload.copilotId,
        payload.eventType,
      )
    }

    if (existingLog) {
      await this.updateQBSyncLog(payload, eq(QBSyncLog.id, existingLog.id))
    } else {
      await this.createQBSyncLog(payload)
    }
  }

  /**
   * Get all failed sync logs grouped by entity type
   */
  async getFailedSyncLogsByEntityType(): Promise<
    postgres.RowList<CustomSyncLogType[]>
  > {
    const query = sql`SELECT 
        entity_type as "entityType",
        event_type as "eventType",
        json_agg(
          json_build_object(
            'copilotId', copilot_id,
            'copilotPriceId', copilot_price_id,
            'status', status,
            'eventType', event_type,
            'invoiceNumber', invoice_number,
            'amount', amount,
            'createdAt', created_at
          )
        ) AS records
      FROM ${QBSyncLog}
      WHERE ${QBSyncLog.portalId} = ${this.user.workspaceId} 
      AND ${QBSyncLog.status} = ${LogStatus.FAILED}
      GROUP BY ${QBSyncLog.entityType}, ${QBSyncLog.eventType}`

    return await this.db.execute(query)
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
        copilot_id: log.copilotId,
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
