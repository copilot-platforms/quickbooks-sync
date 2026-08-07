import { describe, expect, it, beforeEach } from 'vitest'

import { EntityType, EventType, LogStatus } from '@/app/api/core/types/log'
import { db } from '@/db'
import { QBSyncLog } from '@/db/schema/qbSyncLogs'
import { getInvoiceNumbersWithRecordedFee } from '@/db/service/syncLog.service'
import { TEST_PORTAL_ID } from '@test/helpers/seed'
import { truncateAllTestTables } from '@test/helpers/testDb'

const OTHER_PORTAL_ID = 'portal-other-0001'

type LogSeed = {
  invoiceNumber: string
  portalId?: string
  entityType?: EntityType
  eventType?: EventType
  status?: LogStatus
  deletedAt?: Date | null
}

const seedLog = (seed: LogSeed) =>
  db.insert(QBSyncLog).values({
    portalId: seed.portalId ?? TEST_PORTAL_ID,
    copilotId: `pay_${seed.invoiceNumber}`,
    entityType: seed.entityType ?? EntityType.PAYMENT,
    eventType: seed.eventType ?? EventType.SUCCEEDED,
    status: seed.status ?? LogStatus.SUCCESS,
    invoiceNumber: seed.invoiceNumber,
    deletedAt: seed.deletedAt ?? null,
  })

describe('getInvoiceNumbersWithRecordedFee', () => {
  beforeEach(async () => {
    await truncateAllTestTables()
  })

  it('returns invoices that have a SUCCESS PAYMENT/SUCCEEDED log', async () => {
    await seedLog({ invoiceNumber: 'INV-A' })
    await seedLog({ invoiceNumber: 'INV-B' })

    const recorded = await getInvoiceNumbersWithRecordedFee(TEST_PORTAL_ID, [
      'INV-A',
      'INV-B',
    ])

    expect(recorded).toEqual(new Set(['INV-A', 'INV-B']))
  })

  it('only counts the recorded ones, ignoring the rest of the requested list', async () => {
    await seedLog({ invoiceNumber: 'INV-A' })

    const recorded = await getInvoiceNumbersWithRecordedFee(TEST_PORTAL_ID, [
      'INV-A',
      'INV-B',
    ])

    expect(recorded).toEqual(new Set(['INV-A']))
  })

  it('excludes non-SUCCESS, wrong entity/event, soft-deleted, and other-portal rows', async () => {
    await seedLog({ invoiceNumber: 'INV-OK' })
    await seedLog({ invoiceNumber: 'INV-FAILED', status: LogStatus.FAILED })
    await seedLog({
      invoiceNumber: 'INV-WRONG-EVENT',
      eventType: EventType.CREATED,
    })
    await seedLog({
      invoiceNumber: 'INV-WRONG-ENTITY',
      entityType: EntityType.INVOICE,
    })
    await seedLog({ invoiceNumber: 'INV-DELETED', deletedAt: new Date() })
    await seedLog({ invoiceNumber: 'INV-OTHER', portalId: OTHER_PORTAL_ID })

    const recorded = await getInvoiceNumbersWithRecordedFee(TEST_PORTAL_ID, [
      'INV-OK',
      'INV-FAILED',
      'INV-WRONG-EVENT',
      'INV-WRONG-ENTITY',
      'INV-DELETED',
      'INV-OTHER',
    ])

    expect(recorded).toEqual(new Set(['INV-OK']))
  })

  it('returns an empty set for empty input', async () => {
    await seedLog({ invoiceNumber: 'INV-A' })

    const recorded = await getInvoiceNumbersWithRecordedFee(TEST_PORTAL_ID, [])

    expect(recorded).toEqual(new Set())
  })
})
