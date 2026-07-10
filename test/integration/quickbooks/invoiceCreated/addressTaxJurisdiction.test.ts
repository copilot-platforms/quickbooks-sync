import { describe, it, expect, vi } from 'vitest'
import { eq } from 'drizzle-orm'

import { db } from '@/db'
import { QBSyncLog } from '@/db/schema/qbSyncLogs'

import invoiceCreatedPayload from '@test/fixtures/invoiceCreated.webhook'
import {
  seedHealthyPortal,
  seedProductSync,
  TEST_COPILOT_INVOICE_ID,
  TEST_QB_INVOICE_ID,
} from '@test/helpers/seed'
import { createMockIntuitAPI } from '@test/helpers/mocks'
import { setupInvoiceCreatedTest } from '@test/helpers/invoiceCreatedTestSetup'
import { postWebhook } from '@test/helpers/webhook'

// A full US address as Assembly sends it (region is a full state name).
const address = {
  addressLine1: '1 Market St',
  city: 'San Francisco',
  region: 'California',
  postalCode: '94105',
  country: 'US',
}

// The address QBO should receive, with region mapped to its two-letter code.
const expectedQbAddress = {
  Line1: '1 Market St',
  City: 'San Francisco',
  CountrySubDivisionCode: 'CA',
  PostalCode: '94105',
  Country: 'US',
}

const withAddress = (extraData: Record<string, unknown> = {}) => ({
  ...invoiceCreatedPayload,
  data: { ...invoiceCreatedPayload.data, address, ...extraData },
})

describe('POST /api/quickbooks/webhook — invoice.created (customer address on the invoice)', () => {
  const apis = setupInvoiceCreatedTest(() => ({
    intuit: createMockIntuitAPI({
      getAnItem: vi
        .fn()
        .mockImplementation(async (_name?: string, id?: string) =>
          id === '999'
            ? { Id: '999', SyncToken: '0', Active: true }
            : undefined,
        ),
    }),
  }))

  it('sends the address as BillAddr and ShipAddr and always reports Assembly tax', async () => {
    await seedHealthyPortal()
    await seedProductSync()

    const res = await postWebhook(withAddress())
    expect(res.status).toBe(200)

    const [invoicePayload] = apis.intuit.createInvoice.mock.calls[0]
    expect(invoicePayload.BillAddr).toEqual(expectedQbAddress)
    expect(invoicePayload.ShipAddr).toEqual(expectedQbAddress)
    // Address is for the QBO record only; tax always comes from Assembly, so
    // TxnTaxDetail is sent even when the amount is zero.
    expect(invoicePayload.TxnTaxDetail).toEqual({ TotalTax: 0 })

    // The sync log records Assembly's own subtotal and tax, not QBO's numbers.
    const logs = await db
      .select()
      .from(QBSyncLog)
      .where(eq(QBSyncLog.copilotId, TEST_COPILOT_INVOICE_ID))
    expect(logs).toHaveLength(1)
    expect(Number(logs[0].amount)).toBe(60000)
    expect(Number(logs[0].taxAmount)).toBe(0)
  })

  it('sends Assembly non-zero tax as the invoice tax total', async () => {
    await seedHealthyPortal()
    await seedProductSync()

    const res = await postWebhook(withAddress({ taxAmount: 30 }))
    expect(res.status).toBe(200)

    const [invoicePayload] = apis.intuit.createInvoice.mock.calls[0]
    expect(invoicePayload.ShipAddr).toEqual(expectedQbAddress)
    expect(invoicePayload.TxnTaxDetail).toEqual({ TotalTax: 30 })
  })

  it('omits the address when the postal code is missing', async () => {
    await seedHealthyPortal()
    await seedProductSync()

    const { postalCode: _postalCode, ...addressWithoutPostalCode } = address
    const res = await postWebhook(
      withAddress({ address: addressWithoutPostalCode }),
    )
    expect(res.status).toBe(200)

    const [invoicePayload] = apis.intuit.createInvoice.mock.calls[0]
    expect(invoicePayload.ShipAddr).toBeUndefined()
    expect(invoicePayload.BillAddr).toBeUndefined()
    // Tax total is still sent regardless of whether the address made the cut.
    expect(invoicePayload.TxnTaxDetail).toEqual({ TotalTax: 0 })
  })

  it('records the payment for a paid invoice using the invoice total', async () => {
    await seedHealthyPortal()
    await seedProductSync()

    const res = await postWebhook(withAddress({ status: 'paid' }))
    expect(res.status).toBe(200)

    expect(apis.intuit.createPayment).toHaveBeenCalledTimes(1)
    const [paymentPayload] = apis.intuit.createPayment.mock.calls[0]
    // 600 subtotal + 0 tax; both fields use the same Assembly-derived total.
    expect(paymentPayload.TotalAmt).toBe(600)
    expect(paymentPayload.Line[0].Amount).toBe(600)
    expect(paymentPayload.Line[0].LinkedTxn[0]).toMatchObject({
      TxnId: TEST_QB_INVOICE_ID,
      TxnType: 'Invoice',
    })
  })
})
