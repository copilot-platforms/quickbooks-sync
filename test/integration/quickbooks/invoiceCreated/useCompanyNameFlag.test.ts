import { describe, it, expect, vi } from 'vitest'

import { db } from '@/db'
import { QBCustomers } from '@/db/schema/qbCustomers'

import invoiceCreatedPayload from '@test/fixtures/invoiceCreated.webhook.json'
import { seedHealthyPortal, seedProductSync } from '@test/helpers/seed'
import { createMockCopilotAPI } from '@test/helpers/mocks'
import { setupInvoiceCreatedTest } from '@test/helpers/invoiceCreatedTestSetup'
import { postWebhook } from '@test/helpers/webhook'

describe('POST /api/quickbooks/webhook — invoice.created (invoice belongs to a company and the "use company name" setting is on)', () => {
  const apis = setupInvoiceCreatedTest(() => ({
    copilot: createMockCopilotAPI({
      // Payload has companyId but no clientId, so any client lookup is wrong.
      getClient: vi.fn().mockResolvedValue(undefined),
      getCompany: vi.fn().mockResolvedValue({
        id: '22222222-2222-2222-2222-222222222222',
        name: 'Acme Inc',
      }),
    }),
  }))

  it('creates the QuickBooks customer using the company name', async () => {
    await seedHealthyPortal({ setting: { useCompanyNameFlag: true } })
    await seedProductSync()

    const companyPayload = {
      ...invoiceCreatedPayload,
      data: {
        ...invoiceCreatedPayload.data,
        clientId: '',
        companyId: '22222222-2222-2222-2222-222222222222',
      },
    }
    const res = await postWebhook(companyPayload)
    expect(res.status).toBe(200)

    const customers = await db.select().from(QBCustomers)
    expect(customers).toHaveLength(1)
    expect(customers[0]).toMatchObject({
      customerType: 'company',
      companyName: 'Acme Inc',
      displayName: 'Acme Inc',
    })

    expect(apis.intuit.createCustomer).toHaveBeenCalledTimes(1)
    const [createPayload] = apis.intuit.createCustomer.mock.calls[0]
    expect(createPayload).toMatchObject({
      DisplayName: 'Acme Inc',
      CompanyName: 'Acme Inc',
    })

    // When the setting is on, the app must not fall back to listing clients.
    expect(apis.copilot.getClients).not.toHaveBeenCalled()
  })
})
