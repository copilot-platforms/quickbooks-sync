import { describe, it, expect, vi } from 'vitest'

import { db } from '@/db'
import { QBInvoiceSync } from '@/db/schema/qbInvoiceSync'

import invoiceCreatedPayload from '@test/fixtures/invoiceCreated.webhook'
import {
  seedHealthyPortal,
  seedProductSync,
  TEST_INVOICE_NUMBER,
  TEST_QB_INVOICE_ID,
} from '@test/helpers/seed'
import { createMockIntuitAPI } from '@test/helpers/mocks'
import { setupInvoiceCreatedTest } from '@test/helpers/invoiceCreatedTestSetup'
import { postWebhook } from '@test/helpers/webhook'

describe('POST /api/quickbooks/webhook — invoice.created (an invoice with this number already exists in QuickBooks)', () => {
  describe('the duplicate is detected before we attempt to create the invoice', () => {
    const apis = setupInvoiceCreatedTest(() => ({
      intuit: createMockIntuitAPI({
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

      expect(apis.intuit.createInvoice).toHaveBeenCalledTimes(1)
      const [invoicePayload] = apis.intuit.createInvoice.mock.calls[0]
      expect(invoicePayload.DocNumber).toBe(`${TEST_INVOICE_NUMBER}-1`)

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
    // Build mocks inside optsFactory so each beforeEach gets a fresh vi.fn()
    // with a fresh Once-queue. Hoisting them to describe scope would drain
    // the queues after the first run.
    const apis = setupInvoiceCreatedTest(() => {
      const findInvoicesByDocNumberPrefix = vi
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          {
            Id: 'qb-racing-1',
            DocNumber: TEST_INVOICE_NUMBER,
            SyncToken: '0',
          },
        ])

      const duplicateError = Object.assign(
        new Error('Duplicate Document Number'),
        {
          errors: [{ code: '6140', Detail: 'Duplicate Document Number error' }],
        },
      )
      const createInvoice = vi
        .fn()
        .mockRejectedValueOnce(duplicateError)
        .mockResolvedValueOnce({
          Invoice: { Id: TEST_QB_INVOICE_ID, SyncToken: '0' },
        })

      return {
        intuit: createMockIntuitAPI({
          findInvoicesByDocNumberPrefix,
          createInvoice,
        }),
      }
    })

    it('retries with a suffixed number after QuickBooks rejects the first attempt', async () => {
      await seedHealthyPortal()
      await seedProductSync()

      const res = await postWebhook(invoiceCreatedPayload)
      expect(res.status).toBe(200)

      expect(apis.intuit.findInvoicesByDocNumberPrefix).toHaveBeenCalledTimes(2)

      expect(apis.intuit.createInvoice).toHaveBeenCalledTimes(2)
      const [firstPayload] = apis.intuit.createInvoice.mock.calls[0]
      const [secondPayload] = apis.intuit.createInvoice.mock.calls[1]
      expect(firstPayload.DocNumber).toBe(TEST_INVOICE_NUMBER)
      expect(secondPayload.DocNumber).toBe(`${TEST_INVOICE_NUMBER}-1`)

      const invoices = await db.select().from(QBInvoiceSync)
      expect(invoices).toHaveLength(1)
      expect(invoices[0]).toMatchObject({
        invoiceNumber: TEST_INVOICE_NUMBER,
        qbDocNumber: `${TEST_INVOICE_NUMBER}-1`,
      })
    })
  })
})
