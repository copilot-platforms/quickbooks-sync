import APIError from '@/app/api/core/exceptions/api'
import { BaseService } from '@/app/api/core/services/base.service'
import { InvoiceStatus } from '@/app/api/core/types/invoice'
import { EntityType, EventType, LogStatus } from '@/app/api/core/types/log'
import { WebhookEvents } from '@/app/api/core/types/webhook'
import { InvoiceService } from '@/app/api/quickbooks/invoice/invoice.service'
import { PaymentService } from '@/app/api/quickbooks/payment/payment.service'
import { ProductService } from '@/app/api/quickbooks/product/product.service'
import { SettingService } from '@/app/api/quickbooks/setting/setting.service'
import { SyncLogService } from '@/app/api/quickbooks/syncLog/syncLog.service'
import {
  InvoiceCreatedResponseSchema,
  InvoiceDeletedResponseSchema,
  InvoiceResponseSchema,
  PaymentSucceededResponseSchema,
  PriceCreatedResponseSchema,
  ProductCreatedResponseSchema,
  ProductUpdatedResponseSchema,
  WebhookEventResponseSchema,
  WebhookEventResponseType,
} from '@/type/dto/webhook.dto'
import { validateAccessToken } from '@/utils/auth'
import { CopilotAPI } from '@/utils/copilotAPI'
import { IntuitAPITokensType } from '@/utils/intuitAPI'
import httpStatus from 'http-status'

export class WebhookService extends BaseService {
  async handleWebhookEvent(
    body: WebhookEventResponseType,
    qbTokenInfo: IntuitAPITokensType,
  ): Promise<void> {
    let productService: ProductService

    const parsedBody = WebhookEventResponseSchema.safeParse(body)
    if (!parsedBody.success || !parsedBody.data) {
      console.error(
        'WebhookService#handleWebhookEvent | Could not parse webhook body',
      )
      return
    }

    const payload = parsedBody.data
    console.info('Webhook payload:\n', payload)

    // for webhook event price.create, terminate process if createNewProductFlag is false
    if (WebhookEvents.PRICE_CREATED === payload.eventType) {
      const settingService = new SettingService(this.user)
      const setting = await settingService.getOneByPortalId([
        'createNewProductFlag',
      ])

      if (!setting?.createNewProductFlag) {
        console.info(
          'WebhookService#handleWebhookEvent | Create new product flag is false',
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

        try {
          validateAccessToken(qbTokenInfo)
          const invoiceService = new InvoiceService(this.user)
          await invoiceService.webhookInvoiceCreated(
            parsedInvoiceResource,
            qbTokenInfo,
          )
          break
        } catch (error: unknown) {
          await this.pushFailedInvoiceToSyncLog(
            EventType.CREATED,
            parsedInvoiceResource.data.id,
            parsedInvoiceResource.data.number,
            parsedInvoiceResource.data.total,
          )
          throw error
        }

      case WebhookEvents.INVOICE_DELETED:
        return await this.handleInvoiceDeleted(payload.data, qbTokenInfo)

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

        try {
          productService = new ProductService(this.user)
          await productService.webhookProductUpdated(
            parsedProductResource,
            qbTokenInfo,
          )
          break
        } catch (error: unknown) {
          const syncLogService = new SyncLogService(this.user)
          await syncLogService.updateOrCreateQBSyncLog({
            portalId: this.user.workspaceId,
            entityType: EntityType.PRODUCT,
            eventType: EventType.UPDATED,
            status: LogStatus.FAILED,
            copilotId: parsedProductResource.data.id,
            productName: parsedProductResource.data.name,
          })
          throw error
        }

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

        try {
          productService = new ProductService(this.user)
          await productService.webhookPriceCreated(
            parsedCreatedPriceResource,
            qbTokenInfo,
          )
          break
        } catch (error: unknown) {
          const syncLogService = new SyncLogService(this.user)
          await syncLogService.updateOrCreateQBSyncLog({
            portalId: this.user.workspaceId,
            entityType: EntityType.PRODUCT,
            eventType: EventType.CREATED,
            status: LogStatus.FAILED,
            copilotId: parsedCreatedPriceResource.data.productId,
            productPrice: parsedCreatedPriceResource.data.amount?.toFixed(2),
          })
          throw error
        }

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
        try {
          validateAccessToken(qbTokenInfo)
          const invService = new InvoiceService(this.user)
          await invService.webhookInvoicePaid(
            parsedPaidInvoiceResource,
            qbTokenInfo,
          )
          break
        } catch (error: unknown) {
          const syncLogService = new SyncLogService(this.user)

          await syncLogService.updateOrCreateQBSyncLog({
            portalId: this.user.workspaceId,
            entityType: EntityType.INVOICE,
            eventType: EventType.PAID,
            status: LogStatus.FAILED,
            copilotId: parsedPaidInvoiceResource.data.id,
            invoiceNumber: parsedPaidInvoiceResource.data.number,
            amount: parsedPaidInvoiceResource.data.total.toFixed(2),
          })
          throw error
        }

      case WebhookEvents.INVOICE_VOIDED:
        console.info('###### INVOICE VOIDED ######')
        const parsedVoidedInvoice = InvoiceResponseSchema.safeParse(payload)
        if (!parsedVoidedInvoice.success || !parsedVoidedInvoice.data) {
          console.error(
            'WebhookService#handleWebhookEvent | Could not parse invoice void response',
          )
          break
        }
        const parsedVoidedInvoiceResource = parsedVoidedInvoice.data

        try {
          validateAccessToken(qbTokenInfo)
          const invoiceServce = new InvoiceService(this.user)
          await invoiceServce.webhookInvoiceVoided(
            parsedVoidedInvoiceResource,
            qbTokenInfo,
          )
        } catch (error: unknown) {
          await this.pushFailedInvoiceToSyncLog(
            EventType.VOIDED,
            parsedVoidedInvoiceResource.data.id,
            parsedVoidedInvoiceResource.data.number,
            parsedVoidedInvoiceResource.data.total,
          )
          throw error
        }
        break

      case WebhookEvents.PAYMENT_SUCCEEDED:
        console.info('###### PAYMENT SUCCEEDED ######')
        const parsedPaymentSucceed =
          PaymentSucceededResponseSchema.safeParse(payload)
        if (!parsedPaymentSucceed.success || !parsedPaymentSucceed.data) {
          console.error(
            'WebhookService#handleWebhookEvent | Could not parse payment success response',
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

          try {
            const copilotApp = new CopilotAPI(this.user.token)
            const invoice = await copilotApp.getInvoice(
              parsedPaymentSucceedResource.data.invoiceId,
            )
            if (!invoice)
              throw new APIError(httpStatus.NOT_FOUND, 'Invoice not found')
            validateAccessToken(qbTokenInfo)
            // only track if the fee amount is paid by platform
            const paymentService = new PaymentService(this.user)
            await paymentService.webhookPaymentSucceeded(
              parsedPaymentSucceedResource,
              qbTokenInfo,
              invoice,
            )
          } catch (error: unknown) {
            await syncLogService.updateOrCreateQBSyncLog({
              portalId: this.user.workspaceId,
              entityType: EntityType.PAYMENT,
              eventType: EventType.SUCCEEDED,
              status: LogStatus.FAILED,
              copilotId: parsedPaymentSucceedResource.data.id,
              feeAmount:
                parsedPaymentSucceedResource.data.feeAmount.paidByPlatform.toFixed(
                  2,
                ),
              remark: 'Absorbed fees',
              qbItemName: 'Copilot Fees',
            })
            throw error
          }
        }
        break

      default:
        console.error('WebhookService#handleWebhookEvent | Unknown event type')
    }
  }

  private async pushFailedInvoiceToSyncLog(
    eventType: EventType,
    copilotId: string,
    invoiceNumber: string,
    total?: number,
  ) {
    const syncLogService = new SyncLogService(this.user)
    await syncLogService.createQBSyncLog({
      portalId: this.user.workspaceId,
      entityType: EntityType.INVOICE,
      eventType,
      status: LogStatus.FAILED,
      copilotId,
      amount: total?.toFixed(2),
      invoiceNumber,
    })
  }

  private async handleInvoiceDeleted(
    payload: unknown,
    qbTokenInfo: IntuitAPITokensType,
  ) {
    const parsedPayload = InvoiceDeletedResponseSchema.safeParse(payload)
    if (!parsedPayload.success) {
      throw new APIError(
        httpStatus.BAD_REQUEST,
        'WebhookService#handleWebhookEvent | Could not parse invoice deletion response',
      )
    }

    const deletePayload = parsedPayload.data
    try {
      validateAccessToken(qbTokenInfo)
      const invoiceService = new InvoiceService(this.user)
      await invoiceService.handleInvoiceDeleted(deletePayload, qbTokenInfo)
    } catch (error: unknown) {
      await this.pushFailedInvoiceToSyncLog(
        EventType.DELETED,
        deletePayload.id,
        deletePayload.number,
        deletePayload.total,
      )
      throw error
    }
  }
}
