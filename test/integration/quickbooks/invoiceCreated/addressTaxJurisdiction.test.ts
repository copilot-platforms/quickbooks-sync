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

describe('POST /api/quickbooks/webhook — invoice.created (address drives tax jurisdiction)', () => {
  const apis = setupInvoiceCreatedTest(() => ({
    intuit: createMockIntuitAPI({
      getAnItem: vi
        .fn()
        .mockImplementation(async (_name?: string, id?: string) =>
          id === '999'
            ? { Id: '999', SyncToken: '0', Active: true }
            : undefined,
        ),
      // QBO computes its own tax from the jurisdiction and echoes it back.
      createInvoice: vi.fn().mockResolvedValue({
        Invoice: {
          Id: 'qb-inv-1',
          SyncToken: '0',
          TotalAmt: 630,
          TxnTaxDetail: { TotalTax: 30 },
        },
      }),
    }),
  }))

  it('sends the address as ShipAddr and BillAddr and lets QBO compute tax when Assembly tax is zero', async () => {
    await seedHealthyPortal()
    await seedProductSync()

    const res = await postWebhook(withAddress())
    expect(res.status).toBe(200)

    const [invoicePayload] = apis.intuit.createInvoice.mock.calls[0]
    expect(invoicePayload.ShipAddr).toEqual(expectedQbAddress)
    expect(invoicePayload.BillAddr).toEqual(expectedQbAddress)
    // Address present + zero Assembly tax => defer to QBO's automated sales tax.
    expect(invoicePayload.TxnTaxDetail).toBeUndefined()

    // The sync log records the tax QBO actually computed, not Assembly's zero.
    const logs = await db
      .select()
      .from(QBSyncLog)
      .where(eq(QBSyncLog.copilotId, TEST_COPILOT_INVOICE_ID))
    expect(logs).toHaveLength(1)
    expect(Number(logs[0].amount)).toBe(63000)
    expect(Number(logs[0].taxAmount)).toBe(3000)
  })

  it('overrides QBO with Assembly tax when Assembly reports a non-zero tax', async () => {
    await seedHealthyPortal()
    await seedProductSync()

    const res = await postWebhook(withAddress({ taxAmount: 30 }))
    expect(res.status).toBe(200)

    const [invoicePayload] = apis.intuit.createInvoice.mock.calls[0]
    // Address is still sent for the record, but we force our own tax total.
    expect(invoicePayload.ShipAddr).toEqual(expectedQbAddress)
    expect(invoicePayload.TxnTaxDetail).toEqual({ TotalTax: 30 })
  })

  it('omits the address when the postal code is missing, since QBO needs it to resolve the jurisdiction', async () => {
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
    // No usable address => fall back to sending our own (zero) tax total.
    expect(invoicePayload.TxnTaxDetail).toEqual({ TotalTax: 0 })
  })

  it('records the payment for a paid invoice using the tax-inclusive total QBO returned', async () => {
    await seedHealthyPortal()
    await seedProductSync()

    const res = await postWebhook(withAddress({ status: 'paid' }))
    expect(res.status).toBe(200)

    expect(apis.intuit.createPayment).toHaveBeenCalledTimes(1)
    const [paymentPayload] = apis.intuit.createPayment.mock.calls[0]
    // 630 is QBO's tax-inclusive TotalAmt, not the locally-computed 600
    // subtotal. Using the subtotal here would under-record the payment.
    expect(paymentPayload.TotalAmt).toBe(630)
    expect(paymentPayload.Line[0].Amount).toBe(630)
    expect(paymentPayload.Line[0].LinkedTxn[0]).toMatchObject({
      TxnId: TEST_QB_INVOICE_ID,
      TxnType: 'Invoice',
    })
  })
})
