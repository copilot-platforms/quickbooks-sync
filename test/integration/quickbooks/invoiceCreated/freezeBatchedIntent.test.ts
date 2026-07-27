import { describe, it, expect } from 'vitest'
import { db } from '@/db'
import { QBInvoiceSync } from '@/db/schema/qbInvoiceSync'
import invoiceCreatedPayload from '@test/fixtures/invoiceCreated.webhook'
import { seedHealthyPortal, seedProductSync } from '@test/helpers/seed'
import { setupInvoiceCreatedTest } from '@test/helpers/invoiceCreatedTestSetup'
import { postWebhook } from '@test/helpers/webhook'

describe('POST /api/quickbooks/webhook — invoice.created freezes batched-deposit intent', () => {
  setupInvoiceCreatedTest()

  it('stores is_batched_deposit=true when the flag is on at creation', async () => {
    await seedHealthyPortal({ setting: { bankDepositFeeFlag: true } })
    await seedProductSync()
    await postWebhook(invoiceCreatedPayload)
    const [row] = await db.select().from(QBInvoiceSync)
    expect(row.isBatchedDeposit).toBe(true)
  })

  it('stores is_batched_deposit=false when the flag is off at creation', async () => {
    await seedHealthyPortal({ setting: { bankDepositFeeFlag: false } })
    await seedProductSync()
    await postWebhook(invoiceCreatedPayload)
    const [row] = await db.select().from(QBInvoiceSync)
    expect(row.isBatchedDeposit).toBe(false)
  })
})
