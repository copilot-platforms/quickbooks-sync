import { describe, expect, it, beforeEach } from 'vitest'
import { eq } from 'drizzle-orm'
import dayjs from 'dayjs'

import { db } from '@/db'
import { QBSyncLog } from '@/db/schema/qbSyncLogs'
import {
  SyncLogService,
  STALE_PENDING_THRESHOLD_MINUTES,
} from '@/app/api/quickbooks/syncLog/syncLog.service'
import { EntityType, EventType, LogStatus } from '@/app/api/core/types/log'

import { seedHealthyPortal, TEST_PORTAL_ID } from '@test/helpers/seed'
import { truncateAllTestTables } from '@test/helpers/testDb'

const makeUser = () => ({ workspaceId: TEST_PORTAL_ID }) as any

describe('flipStalePendingToFailed keeps a reaped payout claim terminal', () => {
  beforeEach(async () => {
    await truncateAllTestTables()
    await seedHealthyPortal()
  })

  it('flips both stale PENDING rows to FAILED, but only the payout row is non-retryable', async () => {
    const staleCreatedAt = dayjs()
      .subtract(STALE_PENDING_THRESHOLD_MINUTES + 5, 'minutes')
      .toDate()

    await db.insert(QBSyncLog).values([
      {
        portalId: TEST_PORTAL_ID,
        copilotId: 'po_stale_1',
        entityType: EntityType.PAYOUT,
        eventType: EventType.SETTLED,
        status: LogStatus.PENDING,
        createdAt: staleCreatedAt,
      },
      {
        portalId: TEST_PORTAL_ID,
        copilotId: 'inv_stale_1',
        entityType: EntityType.INVOICE,
        eventType: EventType.PAID,
        status: LogStatus.PENDING,
        createdAt: staleCreatedAt,
      },
    ])

    const service = new SyncLogService(makeUser())
    await service.flipStalePendingToFailed()

    const [payoutLog] = await db
      .select()
      .from(QBSyncLog)
      .where(eq(QBSyncLog.copilotId, 'po_stale_1'))
    const [invoiceLog] = await db
      .select()
      .from(QBSyncLog)
      .where(eq(QBSyncLog.copilotId, 'inv_stale_1'))

    expect(payoutLog.status).toBe(LogStatus.FAILED)
    expect(payoutLog.shouldRetry).toBe(false)

    expect(invoiceLog.status).toBe(LogStatus.FAILED)
    expect(invoiceLog.shouldRetry).toBe(true)
  })
})
