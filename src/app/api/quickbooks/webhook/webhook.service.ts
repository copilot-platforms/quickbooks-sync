import APIError from '@/app/api/core/exceptions/api'
import { BaseService } from '@/app/api/core/services/base.service'
import { InvoiceStatus } from '@/app/api/core/types/invoice'
import { EntityType, EventType, LogStatus } from '@/app/api/core/types/log'
import { WebhookEvents } from '@/app/api/core/types/webhook'
import { ExpenseService } from '@/app/api/quickbooks/expense/expense.service'
import { InvoiceService } from '@/app/api/quickbooks/invoice/invoice.service'
import { PaymentService } from '@/app/api/quickbooks/payment/payment.service'
import { ProductService } from '@/app/api/quickbooks/product/product.service'
import { SettingService } from '@/app/api/quickbooks/setting/setting.service'
import { SyncLogService } from '@/app/api/quickbooks/syncLog/syncLog.service'
import {
  InvoiceCreatedResponseSchema,
  InvoiceResponseSchema,
  PaymentSucceededResponseSchema,
  PriceCreatedResponseSchema,
  ProductCreatedResponseSchema,
  ProductUpdatedResponseSchema,
  WebhookEventResponseSchema,
  WebhookEventResponseType,
} from '@/type/dto/webhook.dto'
import { CopilotAPI } from '@/utils/copilotAPI'
import { IntuitAPITokensType } from '@/utils/intuitAPI'
import httpStatus from 'http-status'

export class WebhookService extends BaseService {
  async handleWebhookEvent(
    body: WebhookEventResponseType,
    qbTokenInfo: IntuitAPITokensType,
  ) {
    let productService: ProductService

    const parsedBody = WebhookEventResponseSchema.safeParse(body)
    if (!parsedBody.success || !parsedBody.data) {
      console.error(
        'WebhookService#handleWebhookEvent | Could not parse webhook body',
      )
      return
    }

    const payload = parsedBody.data
    // for webhook event product.create and price.create, terminate process if createNewProductFlag is false
    if (
      [WebhookEvents.PRODUCT_CREATED, WebhookEvents.PRICE_CREATED].includes(
        payload.eventType as WebhookEvents,
      )
    ) {
      const settingService = new SettingService(this.user)
      const setting = await settingService.getOneByPortalId([
        'createNewProductFlag',
      ])

      if (!setting?.createNewProductFlag) {
        console.info(
          'WebhookService#handleWebhookEvent#payment-succeeded | Create new product flag is false',
        )
        return
      }
    }

    switch (payload.eventType) {
      case WebhookEvents.INVOICE_CREATED:
        console.info('###### INVOICE CREATED ######')
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

        try {
          // case when there is no accessToken (refreshToken fail)
          if (qbTokenInfo.accessToken === '') {
            throw new APIError(
              httpStatus.UNAUTHORIZED,
              'Refresh token is expired',
            )
          } else {
            await invoiceService.webhookInvoiceCreated(
              parsedInvoiceResource,
              qbTokenInfo,
            )
            break
          }
        } catch (error: unknown) {
          // store the log as failed.
          const syncLogService = new SyncLogService(this.user)
          await syncLogService.createQBSyncLog({
            portalId: this.user.workspaceId,
            entityType: EntityType.INVOICE,
            eventType: EventType.CREATED,
            status: LogStatus.FAILED,
            copilotId: parsedInvoiceResource.data.id,
          })
          throw error
        }

      case WebhookEvents.PRODUCT_UPDATED:
        console.info('###### PRODUCT UPDATED ######')
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
        console.info('###### PRODUCT CREATED ######')
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
        console.info('###### PRICE CREATED ######')
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
        console.info('###### INVOICE PAID ######')
        const parsedPaidInvoice = InvoiceResponseSchema.safeParse(payload)
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

      case WebhookEvents.INVOICE_VOIDED:
        console.info('###### INVOICE VOIDED ######')
        const parsedVoidedInvoice = InvoiceResponseSchema.safeParse(payload)
        if (!parsedVoidedInvoice.success || !parsedVoidedInvoice.data) {
          console.error(
            'WebhookService#handleWebhookEvent | Could not parse invoice paid response',
          )
          break
        }
        const parsedVoidedInvoiceResource = parsedVoidedInvoice.data

        try {
          if (qbTokenInfo.accessToken === '') {
            throw new APIError(
              httpStatus.UNAUTHORIZED,
              'Refresh token is expired',
            )
          } else {
            const invoiceServce = new InvoiceService(this.user)
            await invoiceServce.webhookInvoiceVoided(
              parsedVoidedInvoiceResource,
              qbTokenInfo,
            )
            break
          }
        } catch (error: unknown) {
          // store the log as failed.
          const syncLogService = new SyncLogService(this.user)
          await syncLogService.createQBSyncLog({
            portalId: this.user.workspaceId,
            entityType: EntityType.INVOICE,
            eventType: EventType.VOIDED,
            status: LogStatus.FAILED,
            copilotId: parsedVoidedInvoiceResource.data.id,
          })
          throw error
        }

      case WebhookEvents.PAYMENT_SUCCEEDED:
        console.info('###### PAYMENT SUCCEEDED ######')
        const parsedPaymentSucceed =
          PaymentSucceededResponseSchema.safeParse(payload)
        if (!parsedPaymentSucceed.success || !parsedPaymentSucceed.data) {
          console.error(
            'WebhookService#handleWebhookEvent | Could not parse invoice paid response',
          )
          break
        }
        const parsedPaymentSucceedResource = parsedPaymentSucceed.data

        if (parsedPaymentSucceedResource.data.feeAmount.paidByPlatform > 0) {
          // check if absorbed fee flag is true
          const settingService = new SettingService(this.user)
          const setting = await settingService.getOneByPortalId([
            'absorbedFeeFlag',
          ])

          if (!setting?.absorbedFeeFlag) {
            console.info(
              'WebhookService#handleWebhookEvent#payment-succeeded | Absorbed fee flag is false',
            )
            break
          }

          const syncLogService = new SyncLogService(this.user)
          const syncLog = await syncLogService.getOneByCopilotIdAndEventType(
            parsedPaymentSucceedResource.data.id,
            EventType.SUCCEEDED,
          )
          if (syncLog?.status === LogStatus.SUCCESS) {
            console.info(
              'WebhookService#webhookPaymentSucceeded | Payment already succeeded',
            )
            return
          }

          const copilotApp = new CopilotAPI(this.user.token)
          const invoice = await copilotApp.getInvoice(
            parsedPaymentSucceedResource.data.invoiceId,
          )

          try {
            if (qbTokenInfo.accessToken === '') {
              throw new APIError(
                httpStatus.UNAUTHORIZED,
                'Refresh token is expired',
              )
            } else {
              // only track if the fee amount is paid by platform
              const paymentService = new PaymentService(this.user)
              await paymentService.webhookPaymentSucceeded(
                parsedPaymentSucceedResource,
                qbTokenInfo,
                invoice,
              )
            }
          } catch (error: unknown) {
            await syncLogService.updateOrCreateQBSyncLog({
              portalId: this.user.workspaceId,
              entityType: EntityType.PAYMENT,
              eventType: EventType.SUCCEEDED,
              status: LogStatus.FAILED,
              copilotId: parsedPaymentSucceedResource.data.id,
              invoiceNumber: invoice?.number,
              amount:
                parsedPaymentSucceedResource.data.feeAmount.paidByPlatform.toFixed(
                  2,
                ),
              remark: 'Absorbed fees',
            })
            throw error
          }
        }
        break

      default:
        console.error('WebhookService#handleWebhookEvent | Unknown event type')
    }
  }
}
