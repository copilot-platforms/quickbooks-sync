import { describe, it, expect } from 'vitest'

import invoiceCreatedPayload from '@test/fixtures/invoiceCreated.webhook'
import {
  seedHealthyPortal,
  seedProductSync,
  TEST_UNDEPOSITED_FUNDS_REF,
} from '@test/helpers/seed'
import { setupInvoiceCreatedTest } from '@test/helpers/invoiceCreatedTestSetup'
import { postWebhook } from '@test/helpers/webhook'

describe('POST /api/quickbooks/webhook — invoice.created (paid-on-create) deposit routing', () => {
  const apis = setupInvoiceCreatedTest()

  const paidPayload = {
    ...invoiceCreatedPayload,
    data: { ...invoiceCreatedPayload.data, status: 'paid' },
  }

  it('routes the payment to Undeposited Funds when the flag is on at creation', async () => {
    await seedHealthyPortal({ setting: { bankDepositFeeFlag: true } })
    await seedProductSync()

    const res = await postWebhook(paidPayload)
    expect(res.status).toBe(200)

    const [paymentPayload] = apis.intuit.createPayment.mock.calls[0]
    expect(paymentPayload.DepositToAccountRef).toEqual({
      value: TEST_UNDEPOSITED_FUNDS_REF,
    })
    expect(apis.intuit.getUndepositedFundsAccountId).toHaveBeenCalledTimes(1)
  })

  it('leaves DepositToAccountRef unset when the flag is off at creation', async () => {
    await seedHealthyPortal({ setting: { bankDepositFeeFlag: false } })
    await seedProductSync()

    const res = await postWebhook(paidPayload)
    expect(res.status).toBe(200)

    const [paymentPayload] = apis.intuit.createPayment.mock.calls[0]
    expect(paymentPayload.DepositToAccountRef).toBeUndefined()
    expect(apis.intuit.getUndepositedFundsAccountId).not.toHaveBeenCalled()
  })
})
