import { describe, it, expect } from 'vitest'

import { db } from '@/db'
import { QBSyncLog } from '@/db/schema/qbSyncLogs'
import User from '@/app/api/core/models/User.model'
import { SyncLogService } from '@/app/api/quickbooks/syncLog/syncLog.service'
import { EntityType, EventType, LogStatus } from '@/app/api/core/types/log'

import { seedHealthyPortal, TEST_PORTAL_ID } from '@test/helpers/seed'
import { truncateAllTestTables } from '@test/helpers/testDb'

describe('SyncLogService.getSuccessfulPaidPaymentIds', () => {
  it('returns only SUCCESS INVOICE/PAID rows for this portal', async () => {
    await truncateAllTestTables()
    await seedHealthyPortal()

    await db.insert(QBSyncLog).values([
      {
        portalId: TEST_PORTAL_ID,
        copilotId: 'inv_a',
        entityType: EntityType.INVOICE,
        eventType: EventType.PAID,
        status: LogStatus.SUCCESS,
        quickbooksId: 'qbpay_a',
      },
      {
        portalId: TEST_PORTAL_ID,
        copilotId: 'inv_b',
        entityType: EntityType.INVOICE,
        eventType: EventType.PAID,
        status: LogStatus.FAILED,
        quickbooksId: 'qbpay_b',
      },
      {
        portalId: 'other-portal',
        copilotId: 'inv_c',
        entityType: EntityType.INVOICE,
        eventType: EventType.PAID,
        status: LogStatus.SUCCESS,
        quickbooksId: 'qbpay_c',
      },
    ])

    const user = { workspaceId: TEST_PORTAL_ID } as User
    const service = new SyncLogService(user)

    const result = await service.getSuccessfulPaidPaymentIds([
      'inv_a',
      'inv_b',
      'inv_c',
    ])

    expect(result.get('inv_a')).toBe('qbpay_a')
    expect(result.has('inv_b')).toBe(false) // FAILED excluded
    expect(result.has('inv_c')).toBe(false) // other portal excluded
    expect(result.size).toBe(1)
  })
})
