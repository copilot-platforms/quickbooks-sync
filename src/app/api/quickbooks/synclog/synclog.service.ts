import { BaseService } from '@/app/api/core/services/base.service'
import { QBSyncLogSelectSchemaType } from '@/db/schema/qbSyncLogs'
import { LogStatus } from '@/app/api/core/types/log'

export class SyncLogService extends BaseService {
  async getLatestSyncSuccessLog(): Promise<Pick<
    QBSyncLogSelectSchemaType,
    'updatedAt'
  > | null> {
    const log = await this.db.query.QBSyncLog.findFirst({
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
    return log || null
  }
}
