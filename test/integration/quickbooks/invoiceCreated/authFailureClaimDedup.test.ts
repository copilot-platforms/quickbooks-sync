import { describe, it, expect, vi } from 'vitest'
import { eq } from 'drizzle-orm'

import { db } from '@/db'
import { QBSyncLog } from '@/db/schema/qbSyncLogs'
import {
  EntityType,
  EventType,
  FailedRecordCategoryType,
  LogStatus,
} from '@/app/api/core/types/log'
import { refreshTokenExpireMessage } from '@/utils/auth'

import invoiceCreatedPayload from '@test/fixtures/invoiceCreated.webhook'
import {
  seedHealthyPortal,
  seedProductSync,
  TEST_COPILOT_INVOICE_ID,
  TEST_PORTAL_ID,
} from '@test/helpers/seed'
import { createMockIntuitAPI } from '@test/helpers/mocks'
import { setupInvoiceCreatedTest } from '@test/helpers/invoiceCreatedTestSetup'
import { postWebhook } from '@test/helpers/webhook'

describe('POST /api/quickbooks/webhook — invoice.created with an expired refresh token', () => {
  // createCustomer throws the same Error message that getCategory matches as
  // FailedRecordCategoryType.AUTH (refreshTokenExpireMessage). The webhook
  // catch block writes shouldRetry=false on the existing claim row.
  const apis = setupInvoiceCreatedTest(() => ({
    intuit: createMockIntuitAPI({
      createCustomer: vi
        .fn()
        .mockRejectedValue(new Error(refreshTokenExpireMessage)),
    }),
  }))

  it('writes one terminal FAILED row and dedupes the next delivery', async () => {
    await seedHealthyPortal()
    await seedProductSync()

    const res1 = await postWebhook(invoiceCreatedPayload)
    expect(res1.status).toBe(200)

    const rowsAfterFirst = await db
      .select()
      .from(QBSyncLog)
      .where(eq(QBSyncLog.copilotId, TEST_COPILOT_INVOICE_ID))

    expect(rowsAfterFirst).toHaveLength(1)
    expect(rowsAfterFirst[0]).toMatchObject({
      portalId: TEST_PORTAL_ID,
      entityType: EntityType.INVOICE,
      eventType: EventType.CREATED,
      status: LogStatus.FAILED,
      category: FailedRecordCategoryType.AUTH,
      shouldRetry: false,
    })
    expect(rowsAfterFirst[0].deletedAt).toBeNull()

    apis.intuit.createCustomer.mockClear()
    const res2 = await postWebhook(invoiceCreatedPayload)
    expect(res2.status).toBe(200)

    const rowsAfterSecond = await db
      .select()
      .from(QBSyncLog)
      .where(eq(QBSyncLog.copilotId, TEST_COPILOT_INVOICE_ID))
    expect(rowsAfterSecond).toHaveLength(1)
    expect(rowsAfterSecond[0].id).toBe(rowsAfterFirst[0].id)
    expect(apis.intuit.createCustomer).not.toHaveBeenCalled()
  })
})
