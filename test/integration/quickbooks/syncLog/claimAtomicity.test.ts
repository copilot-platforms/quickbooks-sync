import { describe, expect, it, beforeEach } from 'vitest'
import { and, eq } from 'drizzle-orm'

import { db } from '@/db'
import { QBSyncLog } from '@/db/schema/qbSyncLogs'
import { SyncLogService } from '@/app/api/quickbooks/syncLog/syncLog.service'
import { EntityType, EventType } from '@/app/api/core/types/log'

import { seedHealthyPortal, TEST_PORTAL_ID } from '@test/helpers/seed'
import { truncateAllTestTables } from '@test/helpers/testDb'

const makeUser = () => ({ workspaceId: TEST_PORTAL_ID }) as any

describe('claimWebhookEvent atomicity', () => {
  beforeEach(async () => {
    await truncateAllTestTables()
    await seedHealthyPortal()
  })

  describe('invoice one-shot events (covered by partial unique index)', () => {
    it('returns claimed=true for the first call and claimed=false for the duplicate (invoice/created)', async () => {
      const service = new SyncLogService(makeUser())
      const args = {
        copilotId: 'inv_abc',
        entityType: EntityType.INVOICE,
        eventType: EventType.CREATED,
        invoiceNumber: 'TEST-00001',
      }
      const first = await service.claimWebhookEvent(args)
      const second = await service.claimWebhookEvent(args)
      expect(first).toEqual({ claimed: true })
      expect(second).toEqual({ claimed: false })

      const rows = await db
        .select()
        .from(QBSyncLog)
        .where(
          and(
            eq(QBSyncLog.portalId, TEST_PORTAL_ID),
            eq(QBSyncLog.copilotId, 'inv_abc'),
            eq(QBSyncLog.eventType, EventType.CREATED),
          ),
        )
      expect(rows).toHaveLength(1)
    })

    it('allows the same copilotId across different event types (created vs paid)', async () => {
      const service = new SyncLogService(makeUser())
      const created = await service.claimWebhookEvent({
        copilotId: 'inv_xyz',
        entityType: EntityType.INVOICE,
        eventType: EventType.CREATED,
        invoiceNumber: 'TEST-00002',
      })
      const paid = await service.claimWebhookEvent({
        copilotId: 'inv_xyz',
        entityType: EntityType.INVOICE,
        eventType: EventType.PAID,
        invoiceNumber: 'TEST-00002',
      })
      expect(created).toEqual({ claimed: true })
      expect(paid).toEqual({ claimed: true })
    })

    it('does not block a fresh claim after the prior row is soft-deleted', async () => {
      const service = new SyncLogService(makeUser())
      const args = {
        copilotId: 'inv_soft',
        entityType: EntityType.INVOICE,
        eventType: EventType.CREATED,
        invoiceNumber: 'TEST-00003',
      }
      const first = await service.claimWebhookEvent(args)
      expect(first).toEqual({ claimed: true })

      await db
        .update(QBSyncLog)
        .set({ deletedAt: new Date() })
        .where(
          and(
            eq(QBSyncLog.portalId, TEST_PORTAL_ID),
            eq(QBSyncLog.copilotId, 'inv_soft'),
          ),
        )

      const second = await service.claimWebhookEvent(args)
      expect(second).toEqual({ claimed: true })
    })
  })

  describe('events outside the partial-index slice', () => {
    it('allows multiple invoice/updated claims for the same copilotId (legitimate multi-update)', async () => {
      const service = new SyncLogService(makeUser())
      const args = {
        copilotId: 'inv_upd',
        entityType: EntityType.INVOICE,
        eventType: EventType.UPDATED,
        invoiceNumber: 'TEST-00004',
      }
      const first = await service.claimWebhookEvent(args)
      const second = await service.claimWebhookEvent(args)
      expect(first).toEqual({ claimed: true })
      expect(second).toEqual({ claimed: true })

      const rows = await db
        .select()
        .from(QBSyncLog)
        .where(
          and(
            eq(QBSyncLog.portalId, TEST_PORTAL_ID),
            eq(QBSyncLog.copilotId, 'inv_upd'),
            eq(QBSyncLog.eventType, EventType.UPDATED),
          ),
        )
      expect(rows).toHaveLength(2)
    })

    it('allows multiple product/updated claims for the same copilotId', async () => {
      const service = new SyncLogService(makeUser())
      const args = {
        copilotId: 'prod_aaa',
        entityType: EntityType.PRODUCT,
        eventType: EventType.UPDATED,
      }
      const first = await service.claimWebhookEvent(args)
      const second = await service.claimWebhookEvent(args)
      expect(first).toEqual({ claimed: true })
      expect(second).toEqual({ claimed: true })
    })
  })

  describe('payment events', () => {
    it('blocks duplicate payment/succeeded claims for the same copilotId', async () => {
      const service = new SyncLogService(makeUser())
      const args = {
        copilotId: 'pay_001',
        entityType: EntityType.PAYMENT,
        eventType: EventType.SUCCEEDED,
        invoiceNumber: 'TEST-00005',
      }
      const first = await service.claimWebhookEvent(args)
      const second = await service.claimWebhookEvent(args)
      expect(first).toEqual({ claimed: true })
      expect(second).toEqual({ claimed: false })
    })
  })
})
