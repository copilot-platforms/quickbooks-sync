import { describe, it, expect } from 'vitest'

import { invoicePaidPayload } from '@test/fixtures/invoicePaid.webhook'
import {
  seedHealthyPortal,
  seedQBCustomer,
  seedQBInvoiceSync,
  seedInvoiceCreatedLog,
  TEST_UNDEPOSITED_FUNDS_REF,
} from '@test/helpers/seed'
import { setupInvoicePaidTest } from '@test/helpers/invoicePaidTestSetup'
import { postWebhook } from '@test/helpers/webhook'

describe('POST /api/quickbooks/webhook — invoice.paid routes off the frozen intent, not the live flag', () => {
  const apis = setupInvoicePaidTest()

  it('routes to Undeposited Funds when the row was frozen batched even though the live flag is now off', async () => {
    // Live flag is off, but the invoice's frozen intent (set at row creation) is batched.
    await seedHealthyPortal({ setting: { bankDepositFeeFlag: false } })
    const customer = await seedQBCustomer()
    await seedQBInvoiceSync({
      customerId: customer.id,
      isBatchedDeposit: true,
    })
    await seedInvoiceCreatedLog()

    const res = await postWebhook(invoicePaidPayload)
    expect(res.status).toBe(200)

    const [paymentPayload] = apis.intuit.createPayment.mock.calls[0]
    expect(paymentPayload.DepositToAccountRef).toEqual({
      value: TEST_UNDEPOSITED_FUNDS_REF,
    })
  })

  it('omits DepositToAccountRef when the row was frozen non-batched even though the live flag is now on', async () => {
    // Live flag is on, but the invoice's frozen intent (set at row creation) is non-batched.
    await seedHealthyPortal({ setting: { bankDepositFeeFlag: true } })
    const customer = await seedQBCustomer()
    await seedQBInvoiceSync({
      customerId: customer.id,
      isBatchedDeposit: false,
    })
    await seedInvoiceCreatedLog()

    const res = await postWebhook(invoicePaidPayload)
    expect(res.status).toBe(200)

    // No DepositToAccountRef → QBO uses its default account, no Undeposited Funds lookup.
    const [paymentPayload] = apis.intuit.createPayment.mock.calls[0]
    expect(paymentPayload.DepositToAccountRef).toBeUndefined()
    expect(apis.intuit.getUndepositedFundsAccountId).not.toHaveBeenCalled()
  })
})
