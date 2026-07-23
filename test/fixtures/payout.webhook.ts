import { WebhookEvents } from '@/app/api/core/types/webhook'
import { TEST_COPILOT_INVOICE_ID } from '@test/helpers/seed'

// Two invoices: $200.00 + $150.00 gross, $3.75 + $2.00 fees → net $344.25 (34425 cents)
export const payoutPayload = {
  eventType: WebhookEvents.PAYOUT_RECONCILIATION_COMPLETED,
  eventTime: '1713744000',
  data: {
    payout: {
      id: 'po_test_1',
      arrivalDate: 1713744000, // 2024-04-22
      currency: 'usd',
      netAmount: 34425,
      status: 'paid',
    },
    lineItems: [
      {
        copilotInvoiceId: TEST_COPILOT_INVOICE_ID,
        grossAmount: 20000,
        feeAmount: 375,
      },
      { copilotInvoiceId: 'inv-cop-0002', grossAmount: 15000, feeAmount: 200 },
    ],
  },
}
