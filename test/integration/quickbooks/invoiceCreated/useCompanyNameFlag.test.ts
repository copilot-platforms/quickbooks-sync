import { describe, it, expect, vi } from 'vitest'

import { db } from '@/db'
import { QBCustomers } from '@/db/schema/qbCustomers'

import invoiceCreatedPayload from '@test/fixtures/invoiceCreated.webhook.json'
import { seedHealthyPortal, seedProductSync } from '@test/helpers/seed'
import { createMockCopilotAPI } from '@test/helpers/mocks'
import { setupInvoiceCreatedTest } from '@test/helpers/invoiceCreatedTestSetup'
import { postWebhook } from '@test/helpers/webhook'

/**
 * Pins the company-only customer resolution path:
 *   - payload has companyId, no clientId
 *   - useCompanyNameFlag=true on the portal setting
 *   - expected: customer is created in QB with DisplayName = company.name
 *     and customerType='company'; copilot.getClients is NOT called (that's
 *     the flag-off branch).
 */
describe('POST /api/quickbooks/webhook — invoice.created (useCompanyNameFlag=true, company-only payload)', () => {
  const apis = setupInvoiceCreatedTest(() => ({
    copilot: createMockCopilotAPI({
      // no clientId in payload, so getClient should not even be called
      getClient: vi.fn().mockResolvedValue(undefined),
      getCompany: vi.fn().mockResolvedValue({
        id: '22222222-2222-2222-2222-222222222222',
        name: 'Acme Inc',
      }),
    }),
  }))

  it('creates a company customer using companyName as DisplayName', async () => {
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

    // customerType='company' with companyName populated
    const customers = await db.select().from(QBCustomers)
    expect(customers).toHaveLength(1)
    expect(customers[0]).toMatchObject({
      customerType: 'company',
      companyName: 'Acme Inc',
      displayName: 'Acme Inc',
    })

    // QB createCustomer called with company DisplayName
    expect(apis.intuit.createCustomer).toHaveBeenCalledTimes(1)
    const [createPayload] = apis.intuit.createCustomer.mock.calls[0]
    expect(createPayload).toMatchObject({
      DisplayName: 'Acme Inc',
      CompanyName: 'Acme Inc',
    })

    // Flag-on branch must NOT call getClients (that's the flag-off fallback)
    expect(apis.copilot.getClients).not.toHaveBeenCalled()
  })
})
