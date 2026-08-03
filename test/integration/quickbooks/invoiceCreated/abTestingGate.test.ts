import { describe, it, expect, afterEach } from 'vitest'
import { db } from '@/db'
import { QBInvoiceSync } from '@/db/schema/qbInvoiceSync'
import invoiceCreatedPayload from '@test/fixtures/invoiceCreated.webhook'
import {
  seedHealthyPortal,
  seedProductSync,
  TEST_PORTAL_ID,
} from '@test/helpers/seed'
import { setupInvoiceCreatedTest } from '@test/helpers/invoiceCreatedTestSetup'
import { postWebhook } from '@test/helpers/webhook'
import { abTestGate } from '@test/helpers/abTestGate'

// The freeze gate must win over the stored flag: a portal outside the AB
// allowlist freezes non-batched even with bankDepositFeeFlag=true, so the whole
// downstream payout/deposit path never engages for it.
describe('POST /api/quickbooks/webhook — invoice.created AB gate on batched intent', () => {
  setupInvoiceCreatedTest()

  afterEach(() => {
    abTestGate.reset()
  })

  it('freezes non-batched for a portal outside the allowlist despite the flag being on', async () => {
    abTestGate.setAllowlist(['some-other-portal'])
    await seedHealthyPortal({ setting: { bankDepositFeeFlag: true } })
    await seedProductSync()

    await postWebhook(invoiceCreatedPayload)

    const [row] = await db.select().from(QBInvoiceSync)
    expect(row.isBatchedDeposit).toBe(false)
  })

  it('freezes batched for a portal on the allowlist with the flag on', async () => {
    abTestGate.setAllowlist([TEST_PORTAL_ID])
    await seedHealthyPortal({ setting: { bankDepositFeeFlag: true } })
    await seedProductSync()

    await postWebhook(invoiceCreatedPayload)

    const [row] = await db.select().from(QBInvoiceSync)
    expect(row.isBatchedDeposit).toBe(true)
  })
})
