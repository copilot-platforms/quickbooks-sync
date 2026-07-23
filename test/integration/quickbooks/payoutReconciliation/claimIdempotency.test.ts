import { describe, it, expect } from 'vitest'

import User from '@/app/api/core/models/User.model'
import { SyncLogService } from '@/app/api/quickbooks/syncLog/syncLog.service'
import { EntityType, EventType } from '@/app/api/core/types/log'

import { seedHealthyPortal, TEST_PORTAL_ID } from '@test/helpers/seed'
import { truncateAllTestTables } from '@test/helpers/testDb'

describe('claimWebhookEvent — payout/settled idempotency', () => {
  it('claims once and refuses the duplicate', async () => {
    await truncateAllTestTables()
    await seedHealthyPortal()

    const user = { workspaceId: TEST_PORTAL_ID } as User
    const service = new SyncLogService(user)

    const first = await service.claimWebhookEvent({
      copilotId: 'po_test_1',
      entityType: EntityType.PAYOUT,
      eventType: EventType.SETTLED,
    })
    const second = await service.claimWebhookEvent({
      copilotId: 'po_test_1',
      entityType: EntityType.PAYOUT,
      eventType: EventType.SETTLED,
    })

    expect(first.claimed).toBe(true)
    expect(second.claimed).toBe(false)
  })
})
