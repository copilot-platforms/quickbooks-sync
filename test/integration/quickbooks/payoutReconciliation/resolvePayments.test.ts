import { describe, it, expect } from 'vitest'

import { db } from '@/db'
import { QBSyncLog } from '@/db/schema/qbSyncLogs'
import User from '@/app/api/core/models/User.model'
import { SyncLogService } from '@/app/api/quickbooks/syncLog/syncLog.service'
import { EntityType, EventType, LogStatus } from '@/app/api/core/types/log'

import {
  seedHealthyPortal,
  seedPaidInvoiceForPayout,
  TEST_PORTAL_ID,
} from '@test/helpers/seed'
import { truncateAllTestTables } from '@test/helpers/testDb'

describe('SyncLogService.getSuccessfulPaidPaymentIds', () => {
  it('returns paymentId + frozen intent only for this portal’s SUCCESS INVOICE/PAID rows', async () => {
    await truncateAllTestTables()
    await seedHealthyPortal()

    // inv_a: SUCCESS in this portal with a matching invoice-sync row → resolves.
    await seedPaidInvoiceForPayout({
      copilotInvoiceId: 'inv_a',
      invoiceNumber: 'INV-A',
      paymentId: 'qbpay_a',
      isBatchedDeposit: true,
    })
    // inv_b: FAILED (excluded by status); inv_c: SUCCESS but another portal.
    await db.insert(QBSyncLog).values([
      {
        portalId: TEST_PORTAL_ID,
        copilotId: 'inv_b',
        entityType: EntityType.INVOICE,
        eventType: EventType.PAID,
        status: LogStatus.FAILED,
        invoiceNumber: 'INV-B',
        quickbooksId: 'qbpay_b',
      },
      {
        portalId: 'other-portal',
        copilotId: 'inv_c',
        entityType: EntityType.INVOICE,
        eventType: EventType.PAID,
        status: LogStatus.SUCCESS,
        invoiceNumber: 'INV-C',
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

    expect(result.get('inv_a')).toEqual({
      paymentId: 'qbpay_a',
      isBatchedDeposit: true,
      invoiceNumber: 'INV-A',
    })
    expect(result.has('inv_b')).toBe(false) // FAILED excluded
    expect(result.has('inv_c')).toBe(false) // other portal excluded
    expect(result.size).toBe(1)
  })
})
