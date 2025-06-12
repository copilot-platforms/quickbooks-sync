import { BaseService } from '@/app/api/core/services/base.service'
import { InvoiceStatus } from '@/app/api/core/types/invoice'
import { WebhookEvents } from '@/app/api/core/types/webhook'
import { InvoiceService } from '@/app/api/quickbooks/invoice/invoice.service'
import { ProductService } from '@/app/api/quickbooks/product/product.service'
import {
  InvoiceCreatedResponseSchema,
  InvoicePaidResponseSchema,
  PriceCreatedResponseSchema,
  ProductCreatedResponseSchema,
  ProductUpdatedResponseSchema,
  WebhookEventResponseType,
} from '@/type/dto/webhook.dto'
import { IntuitAPITokensType } from '@/utils/intuitAPI'

export class WebhookService extends BaseService {
  async handleWebhookEvent(
    payload: WebhookEventResponseType,
    qbTokenInfo: IntuitAPITokensType,
  ) {
    let productService: ProductService
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
          console.info(
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
          console.info(
            'WebhookService#handleWebhookEvent#exists | Invoice already exists in the db',
          )
          break
        }

        // case when there is no accessToken (refreshToken fail)
        if (qbTokenInfo.accessToken === '') {
          // store invoice info in db. Later update the record when sync is back on
          const invoicePayload = {
            portalId: this.user.workspaceId,
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
        const parsedProduct = ProductUpdatedResponseSchema.safeParse(payload)
        if (!parsedProduct.success || !parsedProduct.data) {
          console.error(
            'WebhookService#handleWebhookEvent | Could not parse product updated resource',
          )
          break
        }
        const parsedProductResource = parsedProduct.data
        productService = new ProductService(this.user)
        await productService.webhookProductUpdated(
          parsedProductResource,
          qbTokenInfo,
        )
        break

      case WebhookEvents.PRODUCT_CREATED:
        const parsedCreatedProduct =
          ProductCreatedResponseSchema.safeParse(payload)
        if (!parsedCreatedProduct.success || !parsedCreatedProduct.data) {
          console.error(
            'WebhookService#handleWebhookEvent | Could not parse product created resource',
          )
          break
        }
        const parsedCreatedProductResource = parsedCreatedProduct.data
        productService = new ProductService(this.user)
        await productService.webhookProductCreated(
          parsedCreatedProductResource,
          qbTokenInfo,
        )
        break

      case WebhookEvents.PRICE_CREATED:
        const parsedCreatedPrice = PriceCreatedResponseSchema.safeParse(payload)
        if (!parsedCreatedPrice.success || !parsedCreatedPrice.data) {
          console.error(
            'WebhookService#handleWebhookEvent | Could not parse price created resource',
          )
          break
        }
        const parsedCreatedPriceResource = parsedCreatedPrice.data
        productService = new ProductService(this.user)
        await productService.webhookPriceCreated(
          parsedCreatedPriceResource,
          qbTokenInfo,
        )
        break

      case WebhookEvents.INVOICE_PAID:
        const parsedPaidInvoice = InvoicePaidResponseSchema.safeParse(payload)
        if (!parsedPaidInvoice.success || !parsedPaidInvoice.data) {
          console.error(
            'WebhookService#handleWebhookEvent | Could not parse invoice paid response',
          )
          break
        }
        const parsedPaidInvoiceResource = parsedPaidInvoice.data
        const invService = new InvoiceService(this.user)
        await invService.webhookInvoicePaid(
          parsedPaidInvoiceResource,
          qbTokenInfo,
        )
        break

      default:
        console.error('WebhookService#handleWebhookEvent | Unknown event type')
    }
  }
}
