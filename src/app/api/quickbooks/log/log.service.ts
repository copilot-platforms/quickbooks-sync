import { BaseService } from '@/app/api/core/services/base.service'
import {
  ConnectionStatus,
  QBConnectionLogCreateSchemaType,
  QBConnectionLogs,
  QBConnectionLogSelectSchemaType,
} from '@/db/schema/qbConnectionLogs'
import { eq, sql } from 'drizzle-orm'

export class LogService extends BaseService {
  async storeConnectionLog(
    log: QBConnectionLogCreateSchemaType,
  ): Promise<QBConnectionLogSelectSchemaType> {
    const [resultlog] = await this.db
      .insert(QBConnectionLogs)
      .values(log)
      .returning()
    return resultlog
  }

  async upsertLatestPendingConnectionLog(
    log: QBConnectionLogCreateSchemaType,
  ): Promise<QBConnectionLogSelectSchemaType> {
    const subQuery = sql`(SELECT ${QBConnectionLogs.id} From ${QBConnectionLogs} WHERE ${QBConnectionLogs.portalId} = ${log.portalId}
          AND ${QBConnectionLogs.connectionStatus} = ${ConnectionStatus.PENDING} ORDER BY ${QBConnectionLogs.createdAt} DESC LIMIT 1)`

    const [result] = await this.db
      .update(QBConnectionLogs)
      .set(log)
      .where(eq(QBConnectionLogs.id, subQuery))
      .returning()

    if (!result) {
      return await this.storeConnectionLog(log)
    }
    return result
  }

  async getLatestSuccessLog(): Promise<Pick<
    QBConnectionLogSelectSchemaType,
    'createdAt'
  > | null> {
    const log = await this.db.query.QBConnectionLogs.findFirst({
      where: (logs, { eq, and }) =>
        and(
          eq(logs.portalId, this.user.workspaceId),
          eq(logs.connectionStatus, ConnectionStatus.SUCCESS),
        ),
      orderBy: (logs, { desc }) => [desc(logs.createdAt)],
      columns: {
        createdAt: true,
      },
    })
    return log || null
  }
}
