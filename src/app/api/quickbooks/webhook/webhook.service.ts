import { BaseService } from '@/app/api/core/services/base.service'
import { InvoiceStatus } from '@/app/api/core/types/invoice'
import { WebhookEvents } from '@/app/api/core/types/webhook'
import { InvoiceService } from '@/app/api/quickbooks/invoice/invoice.service'
import { ProductService } from '@/app/api/quickbooks/product/product.service'
import {
  InvoiceCreatedResponseSchema,
  ProductCreatedResponseSchema,
  WebhookEventResponseType,
} from '@/type/dto/webhook.dto'
import { IntuitAPITokensType } from '@/utils/intuitAPI'

export class WebhookService extends BaseService {
  async handleWebhookEvent(
    payload: WebhookEventResponseType,
    qbTokenInfo: IntuitAPITokensType,
  ) {
    switch (payload.eventType) {
      case WebhookEvents.INVOICE_CREATED:
        const parsedPayload = InvoiceCreatedResponseSchema.safeParse(payload)
        if (!parsedPayload.success || !parsedPayload.data) {
          console.error(
            'WebhookService#handleWebhookEvent | Could not parse invoice response',
          )
          break
        }
        const parsedInvoiceResource = parsedPayload.data

        // Check if invoice is in draft status
        if (parsedInvoiceResource.data.status === InvoiceStatus.DRAFT) {
          console.log(
            'WebhookService#handleWebhookEvent#draft | Invoice is in draft status',
          )
          break
        }

        const invoiceService = new InvoiceService(this.user)
        // Check if the invoice with ID already exists in the db
        const invoice = await invoiceService.getInvoiceByNumber(
          parsedInvoiceResource.data.number,
          ['id'],
        )

        // Do not store if invoice already exists
        if (invoice) {
          console.log(
            'WebhookService#handleWebhookEvent#exists | Invoice already exists in the db',
          )
          break
        }

        // case when there is no accessToken (refreshToken fail)
        if (qbTokenInfo.accessToken === '') {
          // store invoice info in db. Later update the record when sync is back on
          const invoicePayload = {
            portalId: qbTokenInfo.intuitRealmId,
            invoiceNumber: parsedInvoiceResource.data.number,
          }
          await invoiceService.createQBInvoice(invoicePayload)
        } else {
          // TODO: when error while creating invoice
          await invoiceService.webhookInvoiceCreated(
            parsedInvoiceResource,
            qbTokenInfo,
          )
        }
        break

      case WebhookEvents.PRODUCT_UPDATED:
        const parsedProduct = ProductCreatedResponseSchema.safeParse(payload)
        if (!parsedProduct.success || !parsedProduct.data) {
          console.error(
            'WebhookService#handleWebhookEvent | Could not parse product update response',
          )
          break
        }
        const parsedProductResource = parsedProduct.data
        const productService = new ProductService(this.user)
        await productService.webhookProductUpdated(
          parsedProductResource,
          qbTokenInfo,
        )
        break

      default:
        console.error('WebhookService#handleWebhookEvent | Unknown event type')
    }
  }
}
