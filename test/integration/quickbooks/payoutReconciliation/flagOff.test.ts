import { describe, it, expect } from 'vitest'
import { eq } from 'drizzle-orm'

import { db } from '@/db'
import { QBSyncLog } from '@/db/schema/qbSyncLogs'
import { EntityType, EventType, LogStatus } from '@/app/api/core/types/log'

import { payoutPayload } from '@test/fixtures/payout.webhook'
import { seedHealthyPortal, TEST_COPILOT_INVOICE_ID } from '@test/helpers/seed'
import { setupPaymentSucceededTest } from '@test/helpers/paymentSucceededTestSetup'
import { postWebhook } from '@test/helpers/webhook'

describe('payout — bank deposit fee flag is off', () => {
  const apis = setupPaymentSucceededTest()

  it('no-ops: no deposit is created and no payout/settled log is written', async () => {
    const { portal } = await seedHealthyPortal({
      setting: { absorbedFeeFlag: true, bankDepositFeeFlag: false },
    })
    await db.insert(QBSyncLog).values([
      {
        portalId: portal.portalId,
        copilotId: TEST_COPILOT_INVOICE_ID,
        entityType: EntityType.INVOICE,
        eventType: EventType.PAID,
        status: LogStatus.SUCCESS,
        quickbooksId: 'qbpay_A',
      },
      {
        portalId: portal.portalId,
        copilotId: 'inv-cop-0002',
        entityType: EntityType.INVOICE,
        eventType: EventType.PAID,
        status: LogStatus.SUCCESS,
        quickbooksId: 'qbpay_B',
      },
    ])

    const res = await postWebhook(payoutPayload)
    expect(res.status).toBe(200)

    expect(apis.intuit.createDeposit).not.toHaveBeenCalled()

    const logs = await db
      .select()
      .from(QBSyncLog)
      .where(eq(QBSyncLog.copilotId, 'po_test_1'))
    expect(logs).toHaveLength(0)
  })
})
