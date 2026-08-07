import APIError from '@/app/api/core/exceptions/api'
import { BaseService } from '@/app/api/core/services/base.service'
import { InvoiceStatus } from '@/app/api/core/types/invoice'
import {
  EntityType,
  EventType,
  FailedRecordCategoryType,
  LogStatus,
} from '@/app/api/core/types/log'
import { WebhookEvents } from '@/app/api/core/types/webhook'
import { InvoiceService } from '@/app/api/quickbooks/invoice/invoice.service'
import { PaymentService } from '@/app/api/quickbooks/payment/payment.service'
import {
  MixedPayoutIntentError,
  getShouldRetryForPayout,
} from '@/app/api/quickbooks/payout/payout.errors'
import { PayoutService } from '@/app/api/quickbooks/payout/payout.service'
import { ProductService } from '@/app/api/quickbooks/product/product.service'
import { SettingService } from '@/app/api/quickbooks/setting/setting.service'
import { SyncLogService } from '@/app/api/quickbooks/syncLog/syncLog.service'
import { QBSyncLog } from '@/db/schema/qbSyncLogs'
import {
  InvoiceCreatedResponseSchema,
  InvoiceDeletedResponseSchema,
  InvoiceResponseSchema,
  PaymentSucceededResponseSchema,
  PayoutReconciliationCompletedSchema,
  ProductCreatedResponseSchema,
  ProductUpdatedResponseSchema,
  WebhookEventResponseSchema,
  WebhookEventResponseType,
} from '@/type/dto/webhook.dto'
import { validateAccessToken } from '@/utils/auth'
import { CopilotAPI } from '@/utils/copilotAPI'
import { ErrorMessageAndCode, getMessageAndCodeFromError } from '@/utils/error'
import { IntuitAPITokensType } from '@/utils/intuitAPI'
import CustomLogger from '@/utils/logger'
import { sleep } from '@/utils/sleep'
import { getCategory, getShouldRetryForCategory } from '@/utils/synclog'
import { addSyncBreadcrumb } from '@/utils/sentry'
import { and, eq } from 'drizzle-orm'
import httpStatus from 'http-status'
import {
  MIXED_INTENT_INVOICE_DELIMITER,
  PAYOUT_MIXED_INTENT_CODE,
} from '@/constant/intuitErrorCode'

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
    addSyncBreadcrumb('Webhook event received', {
      eventType: payload.eventType,
      portalId: this.user.workspaceId,
    })
    CustomLogger.info({
      obj: { payload },
      message: 'WebhookService#handleWebhookEvent | Webhook payload received',
    })

    // for webhook event product.created, terminate process if createNewProductFlag is false
    if (
      WebhookEvents.PRODUCT_CREATED === payload.eventType ||
      WebhookEvents.PRODUCT_UPDATED === payload.eventType
    ) {
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

    // The historical sleeps for INVOICE_UPDATED / INVOICE_VOIDED /
    // PAYMENT_SUCCEEDED give a companion event (e.g. invoice.created) time
    // to claim first. The sleeps are passed *into* the handler and run
    // *before* the claim check, so when this handler wakes and runs its
    // SELECT, the companion's INSERT is already committed and visible —
    // closing the sub-millisecond race that an after-claim sleep would
    // leave open.
    switch (payload.eventType) {
      case WebhookEvents.INVOICE_CREATED:
        return await this.handleInvoiceCreated(payload, qbTokenInfo)

      case WebhookEvents.INVOICE_DELETED:
        return await this.handleInvoiceDeleted(payload.data, qbTokenInfo)

      case WebhookEvents.PRODUCT_UPDATED:
        return await this.handleProductUpdated(payload, qbTokenInfo)

      case WebhookEvents.PRODUCT_CREATED:
        return await this.handleProductCreated(payload, qbTokenInfo)

      case WebhookEvents.INVOICE_PAID:
        return await this.handleInvoicePaid(payload, qbTokenInfo)

      case WebhookEvents.INVOICE_VOIDED:
        return await this.handleInvoiceVoided(payload, qbTokenInfo, {
          delayMs: 14000,
        })

      case WebhookEvents.INVOICE_UPDATED:
        return await this.handleInvoiceCreated(payload, qbTokenInfo, {
          delayMs: 10000,
        })

      case WebhookEvents.PAYMENT_SUCCEEDED:
        return await this.handlePaymentSucceeded(payload, qbTokenInfo, {
          delayMs: 7000,
        })

      case WebhookEvents.PAYOUT_RECONCILIATION_COMPLETED:
        return await this.handlePayoutReconciliationCompleted(
          payload,
          qbTokenInfo,
        )

      default:
        console.error('WebhookService#handleWebhookEvent | Unknown event type')
    }
  }

  private async pushFailedInvoiceToSyncLog(
    eventType: EventType,
    copilotId: string,
    invoiceNumber: string,
    total?: number,
    error?: ErrorMessageAndCode,
  ) {
    const errorMessage = error?.message

    const syncLogService = new SyncLogService(this.user)
    await syncLogService.updateOrCreateQBSyncLog({
      portalId: this.user.workspaceId,
      entityType: EntityType.INVOICE,
      eventType,
      status: LogStatus.FAILED,
      copilotId,
      amount: total?.toFixed(2),
      invoiceNumber,
      errorMessage,
      errorCode: error?.code?.toString(),
      shouldRetry: getShouldRetryForCategory(error),
      category: getCategory(error),
    })
  }

  private async handleInvoiceCreated(
    payload: unknown,
    qbTokenInfo: IntuitAPITokensType,
    opts: { delayMs?: number } = {},
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

    if (opts.delayMs) await sleep(opts.delayMs)

    const syncLogService = new SyncLogService(this.user)
    const { claimed } = await syncLogService.claimWebhookEvent({
      copilotId: parsedInvoiceResource.data.id,
      entityType: EntityType.INVOICE,
      eventType: EventType.CREATED,
      invoiceNumber: parsedInvoiceResource.data.number,
    })
    if (!claimed) {
      console.info(
        `WebhookService#handleInvoiceCreated | Already claimed (invoice/${EventType.CREATED}, copilotId=${parsedInvoiceResource.data.id}), skipping`,
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
      CustomLogger.error({ message: 'Webhook handler failed', obj: error })
      await this.pushFailedInvoiceToSyncLog(
        EventType.CREATED,
        parsedInvoiceResource.data.id,
        parsedInvoiceResource.data.number,
        parsedInvoiceResource.data.total,
        getMessageAndCodeFromError(error),
      )
      console.error(
        `WebhookService#handleWebhookEvent#invoiceCreated :: Error | Portal Id: ${this.user.workspaceId} | Invoice: ${parsedInvoiceResource.data.id}`,
      )
      return
    }
  }

  private async handleInvoiceVoided(
    payload: unknown,
    qbTokenInfo: IntuitAPITokensType,
    opts: { delayMs?: number } = {},
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

    if (opts.delayMs) await sleep(opts.delayMs)

    const syncLogService = new SyncLogService(this.user)
    const { claimed } = await syncLogService.claimWebhookEvent({
      copilotId: parsedVoidedInvoiceResource.data.id,
      entityType: EntityType.INVOICE,
      eventType: EventType.VOIDED,
      invoiceNumber: parsedVoidedInvoiceResource.data.number,
    })
    if (!claimed) {
      console.info(
        `WebhookService#handleInvoiceVoided | Already claimed (invoice/${EventType.VOIDED}, copilotId=${parsedVoidedInvoiceResource.data.id}), skipping`,
      )
      return
    }

    try {
      validateAccessToken(qbTokenInfo)
      const invoiceServce = new InvoiceService(this.user)
      await invoiceServce.webhookInvoiceVoided(
        parsedVoidedInvoiceResource.data,
        qbTokenInfo,
      )
    } catch (error: unknown) {
      CustomLogger.error({ message: 'Webhook handler failed', obj: error })
      await this.pushFailedInvoiceToSyncLog(
        EventType.VOIDED,
        parsedVoidedInvoiceResource.data.id,
        parsedVoidedInvoiceResource.data.number,
        parsedVoidedInvoiceResource.data.total,
        getMessageAndCodeFromError(error),
      )
      console.error(
        `WebhookService#handleWebhookEvent#handleInvoiceVoided :: Error | Portal Id: ${this.user.workspaceId} | Invoice: ${parsedVoidedInvoiceResource.data.id}`,
      )
      return
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

    const syncLogService = new SyncLogService(this.user)
    const { claimed } = await syncLogService.claimWebhookEvent({
      copilotId: deletePayload.id,
      entityType: EntityType.INVOICE,
      eventType: EventType.DELETED,
      invoiceNumber: deletePayload.number,
    })
    if (!claimed) {
      console.info(
        `WebhookService#handleInvoiceDeleted | Already claimed (invoice/${EventType.DELETED}, copilotId=${deletePayload.id}), skipping`,
      )
      return
    }

    try {
      validateAccessToken(qbTokenInfo)
      const invoiceService = new InvoiceService(this.user)
      await invoiceService.handleInvoiceDeleted(deletePayload, qbTokenInfo)
    } catch (error: unknown) {
      CustomLogger.error({ message: 'Webhook handler failed', obj: error })
      await this.pushFailedInvoiceToSyncLog(
        EventType.DELETED,
        deletePayload.id,
        deletePayload.number,
        deletePayload.total,
        getMessageAndCodeFromError(error),
      )
      console.error(
        `WebhookService#handleWebhookEvent#handleInvoiceDeleted :: Error | Portal Id: ${this.user.workspaceId} | Invoice: ${deletePayload.id}`,
      )
      return
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

    const syncLogService = new SyncLogService(this.user)
    const { claimed } = await syncLogService.claimWebhookEvent({
      copilotId: parsedPaidInvoiceResource.data.id,
      entityType: EntityType.INVOICE,
      eventType: EventType.PAID,
      invoiceNumber: parsedPaidInvoiceResource.data.number,
    })
    if (!claimed) {
      console.info(
        `WebhookService#handleInvoicePaid | Already claimed (invoice/${EventType.PAID}, copilotId=${parsedPaidInvoiceResource.data.id}), skipping`,
      )
      return
    }

    try {
      validateAccessToken(qbTokenInfo)
      const invService = new InvoiceService(this.user)
      await invService.webhookInvoicePaid(
        parsedPaidInvoiceResource,
        qbTokenInfo,
      )
    } catch (error: unknown) {
      CustomLogger.error({ message: 'Webhook handler failed', obj: error })
      await this.pushFailedInvoiceToSyncLog(
        EventType.PAID,
        parsedPaidInvoiceResource.data.id,
        parsedPaidInvoiceResource.data.number,
        parsedPaidInvoiceResource.data.total,
        getMessageAndCodeFromError(error),
      )
      console.error(
        `WebhookService#handleWebhookEvent#handleInvoicePaid :: Error | Portal Id: ${this.user.workspaceId} | Invoice: ${parsedPaidInvoiceResource.data.id}`,
      )
      return
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
      CustomLogger.error({ message: 'Webhook handler failed', obj: error })
      const errorWithCode = getMessageAndCodeFromError(error)
      const errorMessage = errorWithCode.message

      const syncLogService = new SyncLogService(this.user)
      await syncLogService.updateOrCreateQBSyncLog({
        portalId: this.user.workspaceId,
        entityType: EntityType.PRODUCT,
        eventType: EventType.UPDATED,
        status: LogStatus.FAILED,
        copilotId: parsedProductResource.data.id,
        productName: parsedProductResource.data.name,
        errorMessage,
        errorCode: errorWithCode.code?.toString(),
        shouldRetry: getShouldRetryForCategory(errorWithCode),
        category: getCategory(errorWithCode),
      })
      console.error(
        `WebhookService#handleWebhookEvent#handleProductUpdated :: Error | Portal Id: ${this.user.workspaceId} | Product: ${parsedProductResource.data.id}`,
      )
      return
    }
  }

  private async handleProductCreated(
    payload: unknown,
    qbTokenInfo: IntuitAPITokensType,
  ) {
    console.info('###### PRODUCT CREATED ######')
    const parsedCreatedProduct = ProductCreatedResponseSchema.safeParse(payload)
    if (!parsedCreatedProduct.success || !parsedCreatedProduct.data) {
      console.error(
        'WebhookService#handleProductCreated | Could not parse product created resource',
      )
      return
    }
    const parsedCreatedProductResource = parsedCreatedProduct.data
    const productResource = parsedCreatedProductResource.data

    try {
      validateAccessToken(qbTokenInfo)
      const productService = new ProductService(this.user)
      await productService.webhookProductCreated(
        parsedCreatedProductResource,
        qbTokenInfo,
      )
    } catch (error: unknown) {
      CustomLogger.error({ message: 'Webhook handler failed', obj: error })
      const syncLogService = new SyncLogService(this.user)
      const conditions = and(
        eq(QBSyncLog.portalId, this.user.workspaceId),
        eq(QBSyncLog.copilotId, productResource.id),
        eq(QBSyncLog.eventType, EventType.CREATED),
      )

      const errorWithCode = getMessageAndCodeFromError(error)
      const errorMessage = errorWithCode.message

      await syncLogService.updateOrCreateQBSyncLog(
        {
          portalId: this.user.workspaceId,
          entityType: EntityType.PRODUCT,
          eventType: EventType.CREATED,
          status: LogStatus.FAILED,
          copilotId: productResource.id,
          productName: productResource.name,
          errorMessage,
          errorCode: errorWithCode.code?.toString(),
          shouldRetry: getShouldRetryForCategory(errorWithCode),
          category: getCategory(errorWithCode),
        },
        conditions,
      )
      console.error(
        `WebhookService#handleWebhookEvent#handleProductCreated :: Error | Portal Id: ${this.user.workspaceId} | ProductId: ${productResource.id}`,
      )
      return
    }
  }

  // Shared FAILED absorbed-fee log for the no-mapping and QB-error paths.
  private async logAbsorbedFeeFailure(opts: {
    copilotId: string
    feeAmount: string
    errorMessage: string
    invoiceNumber?: string
    errorCode?: string
    shouldRetry: boolean
    category?: FailedRecordCategoryType
  }) {
    const syncLogService = new SyncLogService(this.user)
    await syncLogService.updateOrCreateQBSyncLog({
      portalId: this.user.workspaceId,
      entityType: EntityType.PAYMENT,
      eventType: EventType.SUCCEEDED,
      status: LogStatus.FAILED,
      copilotId: opts.copilotId,
      invoiceNumber: opts.invoiceNumber,
      feeAmount: opts.feeAmount,
      remark: 'Absorbed fees',
      qbItemName: 'Assembly Fees',
      errorMessage: opts.errorMessage,
      errorCode: opts.errorCode,
      shouldRetry: opts.shouldRetry,
      category: opts.category,
    })
  }

  private async handlePaymentSucceeded(
    payload: unknown,
    qbTokenInfo: IntuitAPITokensType,
    opts: { delayMs?: number } = {},
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
    const resource = parsedPaymentSucceed.data
    const feeAmount = resource.data.feeAmount

    // Only a platform-absorbed fee books a QBO expense; nothing to do otherwise.
    if (!feeAmount?.paidByPlatform || feeAmount.paidByPlatform <= 0) return

    const { id: paymentId, invoiceId } = resource.data
    const platformFee = feeAmount.paidByPlatform

    // Gate on the absorbed-fee flag before any fetch (off-flag → no Copilot call).
    const settingService = new SettingService(this.user)
    const setting = await settingService.getOneByPortalId(['absorbedFeeFlag'])
    if (!setting?.absorbedFeeFlag) {
      console.info(
        'WebhookService#handlePaymentSucceeded | Absorbed fee flag is false',
      )
      return
    }

    const syncLogService = new SyncLogService(this.user)
    // Cheap duplicate short-circuit before the sleep + Copilot fetch. Status-
    // blind like claimWebhookEvent; FAILED recovery is the resync cron's job.
    const existingPaymentLog =
      await syncLogService.getOneByCopilotIdAndEventType({
        copilotId: paymentId,
        eventType: EventType.SUCCEEDED,
        entityType: EntityType.PAYMENT,
      })
    if (existingPaymentLog) {
      console.info(
        `WebhookService#handlePaymentSucceeded | Already claimed (payment/${EventType.SUCCEEDED}, copilotId=${paymentId}); skipping`,
      )
      return
    }

    if (opts.delayMs) await sleep(opts.delayMs)

    const copilotApp = new CopilotAPI(this.user.token)
    const invoice = await copilotApp.getInvoice(invoiceId)
    if (!invoice)
      throw new APIError(
        httpStatus.NOT_FOUND,
        `Invoice not found in Assembly for invoice id: ${invoiceId}`,
      )

    // Fetch before claiming so the batched defer below writes zero rows.
    const invService = new InvoiceService(this.user)
    const invoiceSync = await invService.getInvoiceByNumber(invoice.number, [
      'id',
      'qbInvoiceId',
      'qbDocNumber',
      'isBatchedDeposit',
    ])

    if (invoiceSync?.isBatchedDeposit) {
      // Frozen batched: the payout books the fee. Defer before claiming.
      console.info(
        'WebhookService#handlePaymentSucceeded | Batched-deposit mode (frozen); deferring to payout event',
      )
      return
    }

    const { claimed } = await syncLogService.claimWebhookEvent({
      copilotId: paymentId,
      eventType: EventType.SUCCEEDED,
      entityType: EntityType.PAYMENT,
    })
    if (!claimed) {
      console.info(
        `WebhookService#handlePaymentSucceeded | Already claimed (payment/${EventType.SUCCEEDED}, copilotId=${paymentId}), skipping`,
      )
      return
    }

    // Post-claim so the update targets the row just claimed, not a racing insert.
    if (!invoiceSync) {
      await this.logAbsorbedFeeFailure({
        copilotId: paymentId,
        feeAmount: platformFee.toFixed(2),
        errorMessage: `No invoice found in invoice sync table for invoice id: ${invoiceId}`,
        shouldRetry: true,
        invoiceNumber: invoice.number,
      })
      return
    }

    try {
      validateAccessToken(qbTokenInfo)
      const paymentService = new PaymentService(this.user)
      await paymentService.webhookPaymentSucceeded({
        parsedPaymentSucceedResource: resource,
        qbTokenInfo,
        qbDocNumber: invoiceSync.qbDocNumber ?? invoice.number,
        invoiceNumber: invoice.number,
      })
    } catch (error: unknown) {
      CustomLogger.error({ message: 'Webhook handler failed', obj: error })
      const errorWithCode = getMessageAndCodeFromError(error)
      await this.logAbsorbedFeeFailure({
        copilotId: paymentId,
        invoiceNumber: invoice.number,
        feeAmount: platformFee.toFixed(2),
        errorMessage: errorWithCode.message,
        errorCode: errorWithCode.code?.toString(),
        shouldRetry: getShouldRetryForCategory(errorWithCode),
        category: getCategory(errorWithCode),
      })
      console.error(
        `WebhookService#handlePaymentSucceeded :: Error | Portal Id: ${this.user.workspaceId} | Payment: ${paymentId}`,
      )
      return
    }
  }

  private async handlePayoutReconciliationCompleted(
    payload: unknown,
    qbTokenInfo: IntuitAPITokensType,
  ) {
    console.info('###### PAYOUT RECONCILIATION COMPLETED ######')
    const parsedPayout = PayoutReconciliationCompletedSchema.safeParse(payload)
    if (!parsedPayout.success) {
      console.error(
        'WebhookService#handlePayoutReconciliationCompleted | Could not parse payout payload',
      )
      return
    }
    const {
      data: { payout, lineItems },
    } = parsedPayout.data

    const payoutId = payout.id
    const syncLogService = new SyncLogService(this.user)
    const payoutService = new PayoutService(this.user)
    const copilotInvoiceIds = lineItems.map((line) => line.copilotInvoiceId)

    // Resolve intent before claiming: an all-non-batched payout books nothing,
    // so skip with zero rows (claiming would leave a PENDING that flips FAILED).
    const paymentIdByInvoice =
      await syncLogService.getSuccessfulPaidPaymentIds(copilotInvoiceIds)
    const resolvedIntents = copilotInvoiceIds.map((id) =>
      paymentIdByInvoice.get(id),
    )
    if (resolvedIntents.every((intent) => intent && !intent.isBatchedDeposit)) {
      console.info(
        `WebhookService#handlePayoutReconciliationCompleted | Payout ${payoutId}: all invoices non-batched, nothing to deposit`,
      )
      return
    }

    // Add up the fee here so the payout row, the success log, and the
    // failure log can all use it.
    const feeCents = lineItems.reduce((sum, line) => sum + line.feeAmount, 0)

    // Save the payout details first so a failed attempt can be rebuilt on
    // resync. Runs before the claim, so a re-sent payout just updates the row.
    const payoutRow = await payoutService.upsertPayoutSync({
      payoutId,
      lineItems,
      netAmount: payout.netAmount,
      feeCents,
      arrivalDate: payout.arrivalDate,
    })

    const { claimed } = await syncLogService.claimWebhookEvent({
      copilotId: payoutId,
      entityType: EntityType.PAYOUT,
      eventType: EventType.SETTLED,
    })
    if (!claimed) {
      console.info(
        `WebhookService#handlePayoutReconciliationCompleted | Already claimed (payout/${EventType.SETTLED}, copilotId=${payoutId}), skipping`,
      )
      return
    }

    try {
      const { depositId } = await payoutService.reconcile(
        payoutRow,
        qbTokenInfo,
        { runIdempotencyCheck: false },
      )

      await syncLogService.updateOrCreateQBSyncLog({
        portalId: this.user.workspaceId,
        entityType: EntityType.PAYOUT,
        eventType: EventType.SETTLED,
        status: LogStatus.SUCCESS,
        copilotId: payoutId,
        quickbooksId: depositId ?? undefined,
        amount: payout.netAmount.toFixed(2),
        feeAmount: feeCents.toFixed(2),
        remark: 'Stripe payout batched deposit',
        qbItemName: 'Stripe payout',
        errorMessage: '',
      })
    } catch (error: unknown) {
      CustomLogger.error({
        message: 'Payout reconciliation handler failed',
        obj: error,
      })
      const isMixed = error instanceof MixedPayoutIntentError
      const errorWithCode = getMessageAndCodeFromError(error)
      // Mixed intent stashes the affected invoice numbers in `remark` (a payout
      // spans multiple invoices, so they don't fit the single invoiceNumber col).
      const affectedInvoiceNumbers = copilotInvoiceIds
        .map((id) => paymentIdByInvoice.get(id)?.invoiceNumber)
        .filter(Boolean)
        .join(MIXED_INTENT_INVOICE_DELIMITER)
      // Single FAILED-log write. Mixed intent gets the routable sentinel so
      // SyncErrorNotifier alerts IUs; everything else keeps its derived code.
      // No qbItemName — it would outrank copilotId (the payout id) in the
      // notification's entity reference.
      await syncLogService.updateOrCreateQBSyncLog({
        portalId: this.user.workspaceId,
        entityType: EntityType.PAYOUT,
        eventType: EventType.SETTLED,
        status: LogStatus.FAILED,
        copilotId: payoutId,
        amount: payout.netAmount.toFixed(2),
        feeAmount: feeCents.toFixed(2),
        remark:
          isMixed && affectedInvoiceNumbers
            ? affectedInvoiceNumbers
            : 'Stripe payout batched deposit',
        errorMessage: errorWithCode.message,
        errorCode: isMixed
          ? PAYOUT_MIXED_INTENT_CODE
          : errorWithCode.code?.toString(),
        shouldRetry: getShouldRetryForPayout(error),
        category: isMixed
          ? FailedRecordCategoryType.OTHERS
          : getCategory(errorWithCode),
      })
      console.error(
        `WebhookService#handlePayoutReconciliationCompleted :: Error | Portal Id: ${this.user.workspaceId} | Payout: ${payoutId}`,
      )
      return
    }
  }
}
