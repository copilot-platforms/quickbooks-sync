import { describe, expect, it, beforeEach } from 'vitest'

import { db } from '@/db'
import { QBSyncLog } from '@/db/schema/qbSyncLogs'
import { SyncLogService } from '@/app/api/quickbooks/syncLog/syncLog.service'
import {
  EntityType,
  EventType,
  FailedRecordCategoryType,
  LogStatus,
} from '@/app/api/core/types/log'

import { seedHealthyPortal, TEST_PORTAL_ID } from '@test/helpers/seed'
import { truncateAllTestTables } from '@test/helpers/testDb'

const makeUser = () => ({ workspaceId: TEST_PORTAL_ID }) as any

describe('getAllFailedLogsForWorkspace includeNoRetry', () => {
  beforeEach(async () => {
    await truncateAllTestTables()
    await seedHealthyPortal()

    // Terminal AUTH-category failure: shouldRetry=false, deletedAt=null so
    // it still occupies the partial unique index slot.
    await db.insert(QBSyncLog).values({
      portalId: TEST_PORTAL_ID,
      copilotId: 'inv-1',
      entityType: EntityType.INVOICE,
      eventType: EventType.CREATED,
      status: LogStatus.FAILED,
      category: FailedRecordCategoryType.AUTH,
      shouldRetry: false,
      invoiceNumber: 'INV-A',
    })

    // Retryable non-terminal failure.
    await db.insert(QBSyncLog).values({
      portalId: TEST_PORTAL_ID,
      copilotId: 'inv-2',
      entityType: EntityType.INVOICE,
      eventType: EventType.CREATED,
      status: LogStatus.FAILED,
      category: FailedRecordCategoryType.OTHERS,
      shouldRetry: true,
      invoiceNumber: 'INV-B',
    })
  })

  it('default (includeNoRetry=false) returns only retryable rows', async () => {
    const service = new SyncLogService(makeUser())
    const logs = await service.getAllFailedLogsForWorkspace()
    expect(logs).toHaveLength(1)
    expect(logs[0].copilotId).toBe('inv-2')
    expect(logs[0].shouldRetry).toBe(true)
  })

  it('includeNoRetry=true returns retryable + terminal rows (reconnect sweep)', async () => {
    const service = new SyncLogService(makeUser())
    const logs = await service.getAllFailedLogsForWorkspace(true)
    expect(logs).toHaveLength(2)
    const copilotIds = logs.map((l) => l.copilotId).sort()
    expect(copilotIds).toEqual(['inv-1', 'inv-2'])
  })
})
