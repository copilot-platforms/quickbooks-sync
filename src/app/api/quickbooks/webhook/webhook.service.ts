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
import { QBSyncLog } from '@/db/schema/qbSyncLogs'
import {
  InvoiceCreatedResponseSchema,
  InvoiceDeletedResponseSchema,
  InvoiceResponseSchema,
  PaymentSucceededResponseSchema,
  PriceCreatedResponseSchema,
  ProductUpdatedResponseSchema,
  WebhookEventResponseSchema,
  WebhookEventResponseType,
} from '@/type/dto/webhook.dto'
import { refreshTokenExpireMessage, validateAccessToken } from '@/utils/auth'
import { CopilotAPI } from '@/utils/copilotAPI'
import { getMessageFromError } from '@/utils/error'
import { IntuitAPITokensType } from '@/utils/intuitAPI'
import CustomLogger from '@/utils/logger'
import { and, eq } from 'drizzle-orm'
import httpStatus from 'http-status'

export class WebhookService extends BaseService {
  async handleWebhookEvent(
    body: WebhookEventResponseType,
    qbTokenInfo: IntuitAPITokensType,
  ): Promise<void> {
    const parsedBody = WebhookEventResponseSchema.safeParse(body)
    if (!parsedBody.success || !parsedBody.data) {
      console.error(
        'WebhookService#handleWebhookEvent | Could not parse webhook body',
      )
      return
    }

    const payload = parsedBody.data
    CustomLogger.info({
      obj: { payload },
      message: 'WebhookService#handleWebhookEvent | Webhook payload received',
    })

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
        return await this.handleInvoiceCreated(payload, qbTokenInfo)

      case WebhookEvents.INVOICE_DELETED:
        return await this.handleInvoiceDeleted(payload.data, qbTokenInfo)

      case WebhookEvents.PRODUCT_UPDATED:
        return await this.handleProductUpdated(payload, qbTokenInfo)

      case WebhookEvents.PRICE_CREATED:
        return await this.handlePriceCreated(payload, qbTokenInfo)

      case WebhookEvents.INVOICE_PAID:
        return await this.handleInvoicePaid(payload, qbTokenInfo)

      case WebhookEvents.INVOICE_VOIDED:
        return await this.handleInvoiceVoided(payload, qbTokenInfo)

      case WebhookEvents.PAYMENT_SUCCEEDED:
        return await this.handlePaymentSucceeded(payload, qbTokenInfo)

      default:
        console.error('WebhookService#handleWebhookEvent | Unknown event type')
    }
  }

  private async pushFailedInvoiceToSyncLog(
    eventType: EventType,
    copilotId: string,
    invoiceNumber: string,
    total?: number,
    errorMessage?: string,
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
      errorMessage,
      deletedAt: errorMessage === refreshTokenExpireMessage ? new Date() : null,
    })
  }

  private async handleInvoiceCreated(
    payload: unknown,
    qbTokenInfo: IntuitAPITokensType,
  ) {
    console.info('###### INVOICE CREATED ######')
    const parsedPayload = InvoiceCreatedResponseSchema.safeParse(payload)
    if (!parsedPayload.success || !parsedPayload.data) {
      console.error(
        'WebhookService#handleWebhookEvent | Could not parse invoice response',
      )
      return
    }
    const parsedInvoiceResource = parsedPayload.data

    // Check if invoice is in draft status
    if (parsedInvoiceResource.data.status === InvoiceStatus.DRAFT) {
      console.info(
        'WebhookService#handleWebhookEvent#draft | Invoice is in draft status',
      )
      return
    }

    try {
      validateAccessToken(qbTokenInfo)
      const invoiceService = new InvoiceService(this.user)
      await invoiceService.webhookInvoiceCreated(
        parsedInvoiceResource,
        qbTokenInfo,
      )
    } catch (error: unknown) {
      await this.pushFailedInvoiceToSyncLog(
        EventType.CREATED,
        parsedInvoiceResource.data.id,
        parsedInvoiceResource.data.number,
        parsedInvoiceResource.data.total,
        getMessageFromError(error),
      )
      throw error
    }
  }

  private async handleInvoiceVoided(
    payload: unknown,
    qbTokenInfo: IntuitAPITokensType,
  ) {
    console.info('###### INVOICE VOIDED ######')
    const parsedVoidedInvoice = InvoiceResponseSchema.safeParse(payload)
    if (!parsedVoidedInvoice.success || !parsedVoidedInvoice.data) {
      console.error(
        'WebhookService#handleWebhookEvent | Could not parse invoice void response',
      )
      return
    }
    const parsedVoidedInvoiceResource = parsedVoidedInvoice.data

    try {
      validateAccessToken(qbTokenInfo)
      const invoiceServce = new InvoiceService(this.user)
      await invoiceServce.webhookInvoiceVoided(
        parsedVoidedInvoiceResource.data,
        qbTokenInfo,
      )
    } catch (error: unknown) {
      await this.pushFailedInvoiceToSyncLog(
        EventType.VOIDED,
        parsedVoidedInvoiceResource.data.id,
        parsedVoidedInvoiceResource.data.number,
        parsedVoidedInvoiceResource.data.total,
        getMessageFromError(error),
      )
      throw error
    }
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
        getMessageFromError(error),
      )
      throw error
    }
  }

  private async handleInvoicePaid(
    payload: unknown,
    qbTokenInfo: IntuitAPITokensType,
  ) {
    console.info('###### INVOICE PAID ######')
    const parsedPaidInvoice = InvoiceResponseSchema.safeParse(payload)
    if (!parsedPaidInvoice.success || !parsedPaidInvoice.data) {
      console.error(
        'WebhookService#handleWebhookEvent | Could not parse invoice paid response',
      )
      return
    }
    const parsedPaidInvoiceResource = parsedPaidInvoice.data
    try {
      validateAccessToken(qbTokenInfo)
      const invService = new InvoiceService(this.user)
      await invService.webhookInvoicePaid(
        parsedPaidInvoiceResource,
        qbTokenInfo,
      )
    } catch (error: unknown) {
      const syncLogService = new SyncLogService(this.user)
      const errorMessage = getMessageFromError(error)

      await syncLogService.updateOrCreateQBSyncLog({
        portalId: this.user.workspaceId,
        entityType: EntityType.INVOICE,
        eventType: EventType.PAID,
        status: LogStatus.FAILED,
        copilotId: parsedPaidInvoiceResource.data.id,
        invoiceNumber: parsedPaidInvoiceResource.data.number,
        amount: parsedPaidInvoiceResource.data.total.toFixed(2),
        errorMessage,
        deletedAt:
          errorMessage === refreshTokenExpireMessage ? new Date() : null,
      })
      throw error
    }
  }

  private async handleProductUpdated(
    payload: unknown,
    qbTokenInfo: IntuitAPITokensType,
  ) {
    console.info('###### PRODUCT UPDATED ######')
    const parsedProduct = ProductUpdatedResponseSchema.safeParse(payload)
    if (!parsedProduct.success || !parsedProduct.data) {
      console.error(
        'WebhookService#handleWebhookEvent | Could not parse product updated resource',
      )
      return
    }
    const parsedProductResource = parsedProduct.data

    try {
      validateAccessToken(qbTokenInfo)
      const productService = new ProductService(this.user)
      await productService.webhookProductUpdated(
        parsedProductResource,
        qbTokenInfo,
      )
    } catch (error: unknown) {
      const errorMessage = getMessageFromError(error)

      const syncLogService = new SyncLogService(this.user)
      await syncLogService.updateOrCreateQBSyncLog({
        portalId: this.user.workspaceId,
        entityType: EntityType.PRODUCT,
        eventType: EventType.UPDATED,
        status: LogStatus.FAILED,
        copilotId: parsedProductResource.data.id,
        productName: parsedProductResource.data.name,
        errorMessage,
        deletedAt:
          errorMessage === refreshTokenExpireMessage ? new Date() : null,
      })
      throw error
    }
  }

  private async handlePriceCreated(
    payload: unknown,
    qbTokenInfo: IntuitAPITokensType,
  ) {
    console.info('###### PRICE CREATED ######')
    const parsedCreatedPrice = PriceCreatedResponseSchema.safeParse(payload)
    if (!parsedCreatedPrice.success || !parsedCreatedPrice.data) {
      console.error(
        'WebhookService#handlePriceCreated | Could not parse price created resource',
      )
      return
    }
    const parsedCreatedPriceResource = parsedCreatedPrice.data
    const priceResource = parsedCreatedPriceResource.data

    try {
      validateAccessToken(qbTokenInfo)
      const productService = new ProductService(this.user)
      await productService.webhookPriceCreated(
        parsedCreatedPriceResource,
        qbTokenInfo,
      )
    } catch (error: unknown) {
      const syncLogService = new SyncLogService(this.user)
      const conditions = and(
        eq(QBSyncLog.portalId, this.user.workspaceId),
        eq(QBSyncLog.copilotId, priceResource.productId),
        eq(QBSyncLog.copilotPriceId, priceResource.id),
        eq(QBSyncLog.eventType, EventType.CREATED),
      )

      const errorMessage = getMessageFromError(error)
      await syncLogService.updateOrCreateQBSyncLog(
        {
          portalId: this.user.workspaceId,
          entityType: EntityType.PRODUCT,
          eventType: EventType.CREATED,
          status: LogStatus.FAILED,
          copilotId: priceResource.productId,
          productPrice: priceResource.amount?.toFixed(2),
          copilotPriceId: priceResource.id,
          errorMessage,
          deletedAt:
            errorMessage === refreshTokenExpireMessage ? new Date() : null,
        },
        conditions,
      )
      throw error
    }
  }

  private async handlePaymentSucceeded(
    payload: unknown,
    qbTokenInfo: IntuitAPITokensType,
  ) {
    console.info('###### PAYMENT SUCCEEDED ######')
    const parsedPaymentSucceed =
      PaymentSucceededResponseSchema.safeParse(payload)
    if (!parsedPaymentSucceed.success || !parsedPaymentSucceed.data) {
      console.error(
        'WebhookService#handleWebhookEvent | Could not parse payment success response',
      )
      return
    }
    const parsedPaymentSucceedResource = parsedPaymentSucceed.data

    if (parsedPaymentSucceedResource.data.feeAmount.paidByPlatform > 0) {
      // check if absorbed fee flag is true
      const settingService = new SettingService(this.user)
      const setting = await settingService.getOneByPortalId(['absorbedFeeFlag'])

      if (!setting?.absorbedFeeFlag) {
        console.info(
          'WebhookService#handleWebhookEvent#payment-succeeded | Absorbed fee flag is false',
        )
        return
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
          throw new APIError(
            httpStatus.NOT_FOUND,
            `Invoice not found for invoice id: ${parsedPaymentSucceedResource.data.invoiceId}`,
          )
        validateAccessToken(qbTokenInfo)
        // only track if the fee amount is paid by platform
        const paymentService = new PaymentService(this.user)
        await paymentService.webhookPaymentSucceeded(
          parsedPaymentSucceedResource,
          qbTokenInfo,
          invoice,
        )
      } catch (error: unknown) {
        const errorMessage = getMessageFromError(error)
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
          qbItemName: 'Assembly Fees',
          errorMessage,
          deletedAt:
            errorMessage === refreshTokenExpireMessage ? new Date() : null,
        })
        throw error
      }
    }
  }
}
