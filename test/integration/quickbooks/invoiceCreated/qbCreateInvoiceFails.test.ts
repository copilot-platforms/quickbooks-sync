import { describe, it, expect, vi } from 'vitest'
import { eq } from 'drizzle-orm'

import { db } from '@/db'
import { QBInvoiceSync } from '@/db/schema/qbInvoiceSync'
import { QBSyncLog } from '@/db/schema/qbSyncLogs'
import { EntityType, EventType, LogStatus } from '@/app/api/core/types/log'

import invoiceCreatedPayload from '@test/fixtures/invoiceCreated.webhook'
import {
  seedHealthyPortal,
  seedProductSync,
  TEST_COPILOT_INVOICE_ID,
} from '@test/helpers/seed'
import { createMockIntuitAPI } from '@test/helpers/mocks'
import { setupInvoiceCreatedTest } from '@test/helpers/invoiceCreatedTestSetup'
import { postWebhook } from '@test/helpers/webhook'

describe('POST /api/quickbooks/webhook — invoice.created (QuickBooks rejects the invoice)', () => {
  const apis = setupInvoiceCreatedTest(() => ({
    intuit: createMockIntuitAPI({
      createInvoice: vi
        .fn()
        .mockRejectedValue(new Error('QuickBooks is on fire')),
    }),
  }))

  it('does not save the invoice locally and marks the sync log as FAILED', async () => {
    await seedHealthyPortal()
    await seedProductSync()

    const res = await postWebhook(invoiceCreatedPayload)
    expect(res.status).toBe(200)

    // Nothing persisted — the QuickBooks call failed before any local insert.
    expect(await db.select().from(QBInvoiceSync)).toHaveLength(0)

    // The claim row that was pending flips to FAILED with the error message.
    const logs = await db
      .select()
      .from(QBSyncLog)
      .where(eq(QBSyncLog.copilotId, TEST_COPILOT_INVOICE_ID))
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatchObject({
      entityType: EntityType.INVOICE,
      eventType: EventType.CREATED,
      status: LogStatus.FAILED,
    })
    expect(logs[0].errorMessage).toContain('QuickBooks is on fire')

    expect(apis.intuit.createInvoice).toHaveBeenCalledTimes(1)
  })
})
