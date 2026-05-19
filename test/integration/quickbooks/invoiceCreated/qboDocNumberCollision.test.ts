import { describe, it, expect, vi } from 'vitest'

import { db } from '@/db'
import { QBInvoiceSync } from '@/db/schema/qbInvoiceSync'

import invoiceCreatedPayload from '@test/fixtures/invoiceCreated.webhook.json'
import {
  seedHealthyPortal,
  seedProductSync,
  TEST_INVOICE_NUMBER,
  TEST_QB_INVOICE_ID,
} from '@test/helpers/seed'
import { createMockIntuitAPI } from '@test/helpers/mocks'
import { setupInvoiceCreatedTest } from '@test/helpers/invoiceCreatedTestSetup'
import { postWebhook } from '@test/helpers/webhook'

/**
 * Covers the case where QuickBooks already has an invoice with the same
 * number — usually because the customer created it manually. The app must
 * not fail the sync; it picks the next free number by appending `-1`, `-2`,
 * etc. and stores both the original Assembly number and the QuickBooks
 * number side by side.
 */
describe('POST /api/quickbooks/webhook — invoice.created (an invoice with this number already exists in QuickBooks)', () => {
  describe('the duplicate is detected before we attempt to create the invoice', () => {
    const apis = setupInvoiceCreatedTest(() => ({
      intuit: createMockIntuitAPI({
        // QuickBooks already has an invoice at the base number, so the next
        // free slot is `${TEST_INVOICE_NUMBER}-1`.
        findInvoicesByDocNumberPrefix: vi.fn().mockResolvedValue([
          {
            Id: 'qb-existing-1',
            DocNumber: TEST_INVOICE_NUMBER,
            SyncToken: '0',
          },
        ]),
      }),
    }))

    it('creates the invoice with a suffixed number and saves both numbers', async () => {
      await seedHealthyPortal()
      await seedProductSync()

      const res = await postWebhook(invoiceCreatedPayload)
      expect(res.status).toBe(200)

      // Only one createInvoice call — and it goes straight to the suffix.
      expect(apis.intuit.createInvoice).toHaveBeenCalledTimes(1)
      const [invoicePayload] = apis.intuit.createInvoice.mock.calls[0]
      expect(invoicePayload.DocNumber).toBe(`${TEST_INVOICE_NUMBER}-1`)

      // Our mapping table keeps the Assembly invoice number and the
      // QuickBooks number as separate columns — that's the whole point of
      // qbDocNumber.
      const invoices = await db.select().from(QBInvoiceSync)
      expect(invoices).toHaveLength(1)
      expect(invoices[0]).toMatchObject({
        invoiceNumber: TEST_INVOICE_NUMBER,
        qbDocNumber: `${TEST_INVOICE_NUMBER}-1`,
        qbInvoiceId: TEST_QB_INVOICE_ID,
      })
    })
  })

  describe('the duplicate slips in between the pre-check and the create attempt', () => {
    // First pre-check returns empty (base looks free). The first create
    // attempt then loses a race and QuickBooks rejects it with a duplicate
    // error. The app re-checks (now finds the base is taken) and retries
    // with `-1`, which succeeds.
    const findInvoicesByDocNumberPrefix = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { Id: 'qb-racing-1', DocNumber: TEST_INVOICE_NUMBER, SyncToken: '0' },
      ])

    const duplicateError = Object.assign(
      new Error('Duplicate Document Number'),
      {
        errors: [{ code: '6240', Detail: 'Duplicate Document Number error' }],
      },
    )
    const createInvoice = vi
      .fn()
      .mockRejectedValueOnce(duplicateError)
      .mockResolvedValueOnce({
        Invoice: { Id: TEST_QB_INVOICE_ID, SyncToken: '0' },
      })

    const apis = setupInvoiceCreatedTest(() => ({
      intuit: createMockIntuitAPI({
        findInvoicesByDocNumberPrefix,
        createInvoice,
      }),
    }))

    it('retries with a suffixed number after QuickBooks rejects the first attempt', async () => {
      await seedHealthyPortal()
      await seedProductSync()

      const res = await postWebhook(invoiceCreatedPayload)
      expect(res.status).toBe(200)

      // One pre-check before the first attempt, one more after the rejection.
      expect(apis.intuit.findInvoicesByDocNumberPrefix).toHaveBeenCalledTimes(2)

      // First attempt with the base number is rejected; the retry uses `-1`.
      expect(apis.intuit.createInvoice).toHaveBeenCalledTimes(2)
      const [firstPayload] = apis.intuit.createInvoice.mock.calls[0]
      const [secondPayload] = apis.intuit.createInvoice.mock.calls[1]
      expect(firstPayload.DocNumber).toBe(TEST_INVOICE_NUMBER)
      expect(secondPayload.DocNumber).toBe(`${TEST_INVOICE_NUMBER}-1`)

      // The retried number is what ends up in the mapping table.
      const invoices = await db.select().from(QBInvoiceSync)
      expect(invoices).toHaveLength(1)
      expect(invoices[0]).toMatchObject({
        invoiceNumber: TEST_INVOICE_NUMBER,
        qbDocNumber: `${TEST_INVOICE_NUMBER}-1`,
      })
    })
  })
})
