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
  PayoutReconciliationCompletedSchema,
  ProductCreatedResponseSchema,
  ProductUpdatedResponseSchema,
  WebhookEventResponseSchema,
  WebhookEventResponseType,
} from '@/type/dto/webhook.dto'
import { TokenService } from '@/app/api/quickbooks/token/token.service'
import { AccountTypeObj } from '@/constant/qbConnection'
import { validateAccessToken } from '@/utils/auth'
import { CopilotAPI } from '@/utils/copilotAPI'
import { ErrorMessageAndCode, getMessageAndCodeFromError } from '@/utils/error'
import IntuitAPI, { IntuitAPITokensType } from '@/utils/intuitAPI'
import CustomLogger from '@/utils/logger'
import { sleep } from '@/utils/sleep'
import { getCategory, getShouldRetryForCategory } from '@/utils/synclog'
import { addSyncBreadcrumb } from '@/utils/sentry'
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
      const errorWithCode = getMessageAndCodeFromError(error)
      const errorMessage = errorWithCode.message

      await syncLogService.updateOrCreateQBSyncLog({
        portalId: this.user.workspaceId,
        entityType: EntityType.INVOICE,
        eventType: EventType.PAID,
        status: LogStatus.FAILED,
        copilotId: parsedPaidInvoiceResource.data.id,
        invoiceNumber: parsedPaidInvoiceResource.data.number,
        amount: parsedPaidInvoiceResource.data.total.toFixed(2),
        errorMessage,
        errorCode: errorWithCode.code?.toString(),
        shouldRetry: getShouldRetryForCategory(errorWithCode),
        category: getCategory(errorWithCode),
      })
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

  private async handlePaymentSucceeded(
    payload: unknown,
    qbTokenInfo: IntuitAPITokensType,
    opts: { delayMs?: number } = {},
  ) {
    await sleep(20000) // Payment succeed event can sometimes trigger before invoice created.

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
    const feeAmount = parsedPaymentSucceedResource.data.feeAmount

    if (feeAmount?.paidByPlatform && feeAmount.paidByPlatform > 0) {
      // check if absorbed fee flag is true
      const settingService = new SettingService(this.user)
      const setting = await settingService.getOneByPortalId([
        'absorbedFeeFlag',
        'bankDepositFeeFlag',
      ])

      if (!setting?.absorbedFeeFlag) {
        console.info(
          'WebhookService#handleWebhookEvent#payment-succeeded | Absorbed fee flag is false',
        )
        return
      }

      if (setting.bankDepositFeeFlag) {
        // Batched mode: deposit happens on payout.reconciliation_completed.
        // Return before claiming so no stale PENDING row is left behind.
        console.info(
          'WebhookService#handlePaymentSucceeded | Batched-deposit mode; deferring deposit to payout event',
        )
        return
      }

      if (opts.delayMs) await sleep(opts.delayMs)

      const syncLogService = new SyncLogService(this.user)
      const { claimed } = await syncLogService.claimWebhookEvent({
        copilotId: parsedPaymentSucceedResource.data.id,
        eventType: EventType.SUCCEEDED,
        entityType: EntityType.PAYMENT,
      })
      if (!claimed) {
        console.info(
          `WebhookService#handlePaymentSucceeded | Already claimed (payment/${EventType.SUCCEEDED}, copilotId=${parsedPaymentSucceedResource.data.id}), skipping`,
        )
        return
      }

      const copilotApp = new CopilotAPI(this.user.token)
      const invoice = await copilotApp.getInvoice(
        parsedPaymentSucceedResource.data.invoiceId,
      )

      if (!invoice)
        throw new APIError(
          httpStatus.NOT_FOUND,
          `Invoice not found in Assembly for invoice id: ${parsedPaymentSucceedResource.data.invoiceId}`,
        )

      try {
        validateAccessToken(qbTokenInfo)
        const invService = new InvoiceService(this.user)
        const invoiceSync = await invService.getInvoiceByNumber(invoice.number)
        if (!invoiceSync) {
          throw new APIError(
            httpStatus.NOT_FOUND,
            `No invoice found in invoice sync table for invoice id: ${parsedPaymentSucceedResource.data.invoiceId}`,
          )
        }
        // only track if the fee amount is paid by platform
        const paymentService = new PaymentService(this.user)

        // Legacy flow: create a standalone expense for absorbed fees
        await paymentService.webhookPaymentSucceeded({
          parsedPaymentSucceedResource,
          qbTokenInfo,
          qbDocNumber: invoiceSync.qbDocNumber ?? invoice.number,
          invoiceNumber: invoice.number,
        })
      } catch (error: unknown) {
        CustomLogger.error({ message: 'Webhook handler failed', obj: error })
        const errorWithCode = getMessageAndCodeFromError(error)
        const errorMessage = errorWithCode.message
        const feeAmount = parsedPaymentSucceedResource.data.feeAmount

        await syncLogService.updateOrCreateQBSyncLog({
          portalId: this.user.workspaceId,
          entityType: EntityType.PAYMENT,
          eventType: EventType.SUCCEEDED,
          status: LogStatus.FAILED,
          copilotId: parsedPaymentSucceedResource.data.id,
          invoiceNumber: invoice?.number,
          feeAmount: feeAmount ? feeAmount.paidByPlatform.toFixed(2) : '0',
          remark: 'Absorbed fees',
          qbItemName: 'Assembly Fees',
          errorMessage,
          errorCode: errorWithCode.code?.toString(),
          shouldRetry: getShouldRetryForCategory(errorWithCode),
          category: getCategory(errorWithCode),
        })
        console.error(
          `WebhookService#handleWebhookEvent#handlePaymentSucceeded :: Error | Portal Id: ${this.user.workspaceId} | Payment: ${parsedPaymentSucceedResource.data.id}`,
        )
        return
      }
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

    const settingService = new SettingService(this.user)
    const setting = await settingService.getOneByPortalId([
      'bankDepositFeeFlag',
    ])
    if (!setting?.bankDepositFeeFlag) {
      console.info(
        'WebhookService#handlePayoutReconciliationCompleted | Batching disabled (bankDepositFeeFlag off)',
      )
      return
    }

    const syncLogService = new SyncLogService(this.user)
    const { claimed } = await syncLogService.claimWebhookEvent({
      copilotId: payout.id,
      entityType: EntityType.PAYOUT,
      eventType: EventType.SETTLED,
    })
    if (!claimed) {
      console.info(
        `WebhookService#handlePayoutReconciliationCompleted | Already claimed (payout/${EventType.SETTLED}, copilotId=${payout.id}), skipping`,
      )
      return
    }

    // Computed before the try so the FAILED-log path can record the amounts.
    const grossCents = lineItems.reduce((sum, l) => sum + l.grossAmount, 0)
    const feeCents = lineItems.reduce((sum, l) => sum + l.feeAmount, 0)

    try {
      validateAccessToken(qbTokenInfo)

      // v1: refunds unsupported — a negative line means QBO cannot link to a Payment.
      if (lineItems.some((line) => line.grossAmount < 0)) {
        throw new APIError(
          httpStatus.BAD_REQUEST,
          `Payout ${payout.id} contains refund lines; batched deposit unsupported in v1`,
        )
      }

      // A negative total fee would drop the fee line and unbalance the
      // deposit. Abort instead (fee credits arrive with refund support).
      if (feeCents < 0) {
        throw new APIError(
          httpStatus.BAD_REQUEST,
          `Payout ${payout.id} has a negative aggregate fee (${feeCents}); unsupported in v1`,
        )
      }

      const copilotInvoiceIds = lineItems.map((line) => line.copilotInvoiceId)
      if (new Set(copilotInvoiceIds).size !== copilotInvoiceIds.length) {
        throw new APIError(
          httpStatus.BAD_REQUEST,
          `Payout ${payout.id} contains duplicate invoice line items`,
        )
      }
      const paymentIdByInvoice =
        await syncLogService.getSuccessfulPaidPaymentIds(copilotInvoiceIds)
      const unresolved = copilotInvoiceIds.filter(
        (id) => !paymentIdByInvoice.has(id),
      )
      if (unresolved.length > 0) {
        throw new APIError(
          httpStatus.NOT_FOUND,
          `Payout ${payout.id}: no SUCCESS INVOICE/PAID sync log for invoices [${unresolved.join(', ')}]`,
        )
      }

      if (grossCents - feeCents !== payout.netAmount) {
        throw new APIError(
          httpStatus.BAD_REQUEST,
          `Payout ${payout.id}: deposit total ${grossCents - feeCents} != payout net ${payout.netAmount}`,
        )
      }

      // Fail fast on the free local check before any QBO round-trip.
      const bankAccountRef = qbTokenInfo.bankAccountRef
      if (!bankAccountRef) {
        throw new APIError(
          httpStatus.BAD_REQUEST,
          `Bank account ref is not configured for portal ${this.user.workspaceId}. Please select a bank account in the QuickBooks integration settings.`,
        )
      }

      const intuitApi = new IntuitAPI(qbTokenInfo)
      const tokenService = new TokenService(this.user)
      // Reactivates an archived bank account; a deleted one throws.
      const verifiedBankAccountRef =
        await tokenService.checkAndUpdateAccountStatus(
          AccountTypeObj.Bank,
          qbTokenInfo.intuitRealmId,
          intuitApi,
          bankAccountRef,
        )
      const expenseAccountRef = await tokenService.checkAndUpdateAccountStatus(
        AccountTypeObj.Expense,
        qbTokenInfo.intuitRealmId,
        intuitApi,
        qbTokenInfo.expenseAccountRef,
      )

      const paymentService = new PaymentService(this.user)
      const depositId = await paymentService.createBankDepositForPayment(
        intuitApi,
        {
          lines: lineItems.map((line) => ({
            qbPaymentId: paymentIdByInvoice.get(
              line.copilotInvoiceId,
            ) as string,
            amount: line.grossAmount / 100,
          })),
          feeTotal: feeCents / 100,
          bankAccountRef: verifiedBankAccountRef,
          expenseAccountRef,
          txnDate: new Date(payout.arrivalDate * 1000)
            .toISOString()
            .split('T')[0],
          privateNote: `Stripe payout ${payout.id}`,
        },
      )

      await syncLogService.updateOrCreateQBSyncLog({
        portalId: this.user.workspaceId,
        entityType: EntityType.PAYOUT,
        eventType: EventType.SETTLED,
        status: LogStatus.SUCCESS,
        copilotId: payout.id,
        quickbooksId: depositId,
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
      const errorWithCode = getMessageAndCodeFromError(error)
      await syncLogService.updateOrCreateQBSyncLog({
        portalId: this.user.workspaceId,
        entityType: EntityType.PAYOUT,
        eventType: EventType.SETTLED,
        status: LogStatus.FAILED,
        copilotId: payout.id,
        amount: payout.netAmount.toFixed(2),
        feeAmount: feeCents.toFixed(2),
        remark: 'Stripe payout batched deposit',
        qbItemName: 'Stripe payout',
        errorMessage: errorWithCode.message,
        errorCode: errorWithCode.code?.toString(),
        // Terminal: no PAYOUT resync path yet, so retrying only burns
        // attempts to a misleading alert. Recovery is manual for now.
        shouldRetry: false,
        category: getCategory(errorWithCode),
      })
      console.error(
        `WebhookService#handlePayoutReconciliationCompleted :: Error | Portal Id: ${this.user.workspaceId} | Payout: ${payout.id}`,
      )
      return
    }
  }
}
