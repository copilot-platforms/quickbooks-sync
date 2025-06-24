import { BaseService } from '@/app/api/core/services/base.service'
import { EntityType, EventType, LogStatus } from '@/app/api/core/types/log'
import {
  QBSyncLog,
  QBSyncLogCreateSchema,
  QBSyncLogCreateSchemaType,
  QBSyncLogSelectSchemaType,
  QBSyncLogUpdateSchema,
  QBSyncLogUpdateSchemaType,
} from '@/db/schema/qbSyncLogs'
import { WhereClause } from '@/type/common'
import { and, eq, isNull, sql } from 'drizzle-orm'
import postgres from 'postgres'

export type CustomSyncLogRecordType = {
  copilotId: string
  status: LogStatus
  eventType: EventType
  invoiceNumber: string
  amount: number
  createdAt: Date
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
    const conditions = and(
      eq(QBSyncLog.portalId, this.user.workspaceId),
      eq(QBSyncLog.copilotId, copilotId),
      eventType && eq(QBSyncLog.eventType, eventType),
    )
    const query = this.db.query.QBSyncLog.findFirst({
      where: conditions,
    })
    return await query
  }

  async updateOrCreateQBSyncLog(payload: QBSyncLogCreateSchemaType) {
    const existingLog = await this.getOneByCopilotIdAndEventType(
      payload.copilotId,
      payload.eventType,
    )
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
      AND ${QBSyncLog.quickbooksId} IS NULL
      GROUP BY ${QBSyncLog.entityType}, ${QBSyncLog.eventType}`

    return await this.db.execute(query)
  }
}
