import { describe, it, expect, vi } from 'vitest'
import { eq } from 'drizzle-orm'

import { db } from '@/db'
import { QBProductSync } from '@/db/schema/qbProductSync'
import { QBSyncLog } from '@/db/schema/qbSyncLogs'
import { EntityType, EventType, LogStatus } from '@/app/api/core/types/log'

import priceCreatedPayload from '@test/fixtures/priceCreated.webhook.json'
import { seedHealthyPortal, TEST_PORTAL_ID } from '@test/helpers/seed'
import { createMockCopilotAPI } from '@test/helpers/mocks'
import { setupPriceCreatedTest } from '@test/helpers/priceCreatedTestSetup'
import { postWebhook } from '@test/helpers/webhook'

/**
 * Copilot product not found (deleted between webhook firing and handler
 * running, or stale cache). ProductService throws APIError(404). The
 * transaction rolls back, and the outer catch in WebhookService writes a
 * FAILED sync log.
 */
describe('POST /api/quickbooks/webhook — price.created (copilot product 404)', () => {
  const apis = setupPriceCreatedTest(() => ({
    copilot: createMockCopilotAPI({
      // Real CopilotAPI.getProduct returns undefined when the product
      // doesn't exist; the service treats that as a 404.
      getProduct: vi.fn().mockResolvedValue(undefined),
    }),
  }))

  it('writes a FAILED sync log and never touches QB', async () => {
    await seedHealthyPortal()

    const res = await postWebhook(priceCreatedPayload)
    expect(res.status).toBe(200)

    // Pin down that the 404 path actually went through Copilot — a future
    // refactor that returns early before calling getProduct would otherwise
    // still pass the "no QB calls" assertions below.
    expect(apis.copilot.getProduct).toHaveBeenCalledWith(
      priceCreatedPayload.data.productId,
    )

    // The 404 is raised BEFORE any QB call
    expect(apis.intuit.getAnItem).not.toHaveBeenCalled()
    expect(apis.intuit.createItem).not.toHaveBeenCalled()

    // No mapping row
    const productRows = await db.select().from(QBProductSync)
    expect(productRows).toHaveLength(0)

    // FAILED sync log
    const failedLogs = await db
      .select()
      .from(QBSyncLog)
      .where(eq(QBSyncLog.copilotPriceId, priceCreatedPayload.data.id))

    expect(failedLogs).toHaveLength(1)
    expect(failedLogs[0]).toMatchObject({
      portalId: TEST_PORTAL_ID,
      entityType: EntityType.PRODUCT,
      eventType: EventType.CREATED,
      status: LogStatus.FAILED,
      copilotId: priceCreatedPayload.data.productId,
      copilotPriceId: priceCreatedPayload.data.id,
    })
    expect(failedLogs[0].errorMessage).toMatch(/Product not found/i)
  })
})
