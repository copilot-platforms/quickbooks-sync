import { BaseService } from '@/app/api/core/services/base.service'
import { SyncLogService } from '@/app/api/quickbooks/syncLog/syncLog.service'
import { InvoiceService } from '@/app/api/quickbooks/invoice/invoice.service'
import { AuthService } from '@/app/api/quickbooks/auth/auth.service'
import IntuitAPI, { IntuitAPITokensType } from '@/utils/intuitAPI'
import { CopilotAPI } from '@/utils/copilotAPI'
import { EntityType, EventType } from '@/app/api/core/types/log'
import User from '@/app/api/core/models/User.model'
import { PaymentService } from '@/app/api/quickbooks/payment/payment.service'
import dayjs from 'dayjs'
import { ProductService } from '@/app/api/quickbooks/product/product.service'
import CustomLogger from '@/utils/logger'
import { QBSyncLogSelectSchemaType } from '@/db/schema/qbSyncLogs'
import { z } from 'zod'

export class SyncService extends BaseService {
  private invoiceService: InvoiceService
  private syncLogService: SyncLogService

  constructor(user: User) {
    super(user)
    this.invoiceService = new InvoiceService(user)
    this.syncLogService = new SyncLogService(user)
  }

  private async processInvoiceCreate(
    record: QBSyncLogSelectSchemaType,
    qbTokenInfo: IntuitAPITokensType,
  ) {
    const copilotApi = new CopilotAPI(this.user.token)

    try {
      // get invoice from Copilot API
      const invoice = await copilotApi.getInvoice(record.copilotId)
      if (!invoice) {
        await this.syncLogService.deleteQBSyncLog(record.id)
        return
      }

      // start re-sync process
      await this.invoiceService.webhookInvoiceCreated(
        { data: invoice },
        qbTokenInfo,
      )
    } catch (error: unknown) {
      CustomLogger.error({
        message: 'SyncService#processInvoiceCreate',
        obj: { error, invoiceNumber: record.invoiceNumber },
      })
    }
  }

  private async processInvoicePaid(
    record: QBSyncLogSelectSchemaType,
    qbTokenInfo: IntuitAPITokensType,
  ) {
    const copilotApi = new CopilotAPI(this.user.token)

    try {
      // get invoice from Copilot API
      const invoice = await copilotApi.getInvoice(record.copilotId)
      if (!invoice) {
        await this.syncLogService.deleteQBSyncLog(record.id)
        return
      }

      // start re-sync process
      await this.invoiceService.webhookInvoicePaid(
        { data: invoice },
        qbTokenInfo,
      )
    } catch (error: unknown) {
      CustomLogger.error({
        message: 'SyncService#processInvoicePaid',
        obj: { error, invoiceNumber: record.invoiceNumber },
      })
    }
  }

  private async processInvoiceVoided(
    record: QBSyncLogSelectSchemaType,
    qbTokenInfo: IntuitAPITokensType,
  ) {
    try {
      const invNumber = z.string().parse(record.invoiceNumber)
      const invoiceSync =
        await this.invoiceService.getInvoiceByNumber(invNumber)
      if (!invoiceSync) {
        CustomLogger.info({
          message: 'SyncService#processInvoiceVoided | No invoice found',
          obj: { invoiceNumber: record.invoiceNumber },
        })
        await this.syncLogService.deleteQBSyncLog(record.id)
        return
      }

      if (!invoiceSync.customer) {
        CustomLogger.info({
          message: 'SyncService#processInvoiceVoided | No customer found',
          obj: { invoiceNumber: record.invoiceNumber },
        })
        return
      }

      const invoice = {
        id: record.copilotId,
        number: invNumber,
        total: record.amount ? parseFloat(record.amount) / 100 : 0, // assuming amount is in cents
        clientId: invoiceSync.customer.clientId || '',
        companyId: invoiceSync.customer.companyId || '',
      }
      await this.invoiceService.webhookInvoiceVoided(invoice, qbTokenInfo)
    } catch (error: unknown) {
      CustomLogger.error({
        message: 'SyncService#processInvoiceVoided',
        obj: { error, invoiceNumber: record.invoiceNumber },
      })
    }
  }

  private async processInvoiceDeleted(
    record: QBSyncLogSelectSchemaType,
    qbTokenInfo: IntuitAPITokensType,
  ) {
    try {
      const invNumber = z.string().parse(record.invoiceNumber)
      const invoiceSync =
        await this.invoiceService.getInvoiceByNumber(invNumber)
      if (!invoiceSync) {
        CustomLogger.info({
          message: 'SyncService#processInvoiceDeleted | No invoice found',
          obj: { invoiceNumber: record.invoiceNumber },
        })
        await this.syncLogService.deleteQBSyncLog(record.id)
        return
      }

      if (!invoiceSync.customer) {
        CustomLogger.info({
          message: 'SyncService#processInvoiceDeleted | No customer found',
          obj: { invoiceNumber: record.invoiceNumber },
        })
        return
      }

      const invoice = {
        id: record.copilotId,
        number: invNumber,
        total: record.amount ? parseFloat(record.amount) / 100 : 0, // assuming amount is in cents
        clientId: invoiceSync.customer.clientId || '',
        companyId: invoiceSync.customer.companyId || '',
      }

      await this.invoiceService.handleInvoiceDeleted(invoice, qbTokenInfo)
    } catch (error: unknown) {
      CustomLogger.error({
        message: 'SyncService#processInvoiceDeleted',
        obj: { error, invoiceNumber: record.invoiceNumber },
      })
    }
  }

  private async processInvoiceSync(
    record: QBSyncLogSelectSchemaType,
    qbTokenInfo: IntuitAPITokensType,
    eventType: EventType,
  ) {
    CustomLogger.info({
      message: 'SyncService#processInvoiceSync',
      obj: { eventType },
    })

    switch (eventType) {
      case EventType.CREATED:
        await this.processInvoiceCreate(record, qbTokenInfo)
        break

      case EventType.PAID:
        await this.processInvoicePaid(record, qbTokenInfo)
        break

      case EventType.VOIDED:
        await this.processInvoiceVoided(record, qbTokenInfo)
        break

      case EventType.DELETED:
        await this.processInvoiceDeleted(record, qbTokenInfo)
        break

      default:
        CustomLogger.error({
          message: 'SyncLogService#processInvoiceSync | Unknown event type',
          obj: { eventType },
        })
        break
    }
  }

  private async processPaymentSucceededSync(
    record: QBSyncLogSelectSchemaType,
    qbTokenInfo: IntuitAPITokensType,
  ) {
    try {
      CustomLogger.info({
        message: 'syncService#processPaymentSucceededSync | records: ',
        obj: record,
      })

      const expensePayload = {
        PaymentType: 'Cash' as const,
        AccountRef: {
          value: qbTokenInfo.assetAccountRef,
        },
        DocNumber: record.invoiceNumber || '',
        TxnDate: dayjs(record.createdAt).format('YYYY-MM-DD'), // the date format for due date follows XML Schema standard (YYYY-MM-DD). For more info: https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/purchase#the-purchase-object
        Line: [
          {
            DetailType: 'AccountBasedExpenseLineDetail' as const,
            Amount: parseFloat(z.string().parse(record.feeAmount)) / 100, // fee amount is required for payment/expense creation
            AccountBasedExpenseLineDetail: {
              AccountRef: {
                value: qbTokenInfo.expenseAccountRef,
              },
            },
          },
        ],
      }
      const paymentService = new PaymentService(this.user)
      const intuitApi = new IntuitAPI(qbTokenInfo)
      await paymentService.createExpenseForAbsorbedFees(
        expensePayload,
        intuitApi,
        record.copilotId,
      )
    } catch (error: unknown) {
      CustomLogger.error({
        message: 'SyncService#processPaymentSucceededSync',
        obj: { error },
      })
    }
  }

  private async processProductCreate(
    record: QBSyncLogSelectSchemaType,
    qbTokenInfo: IntuitAPITokensType,
  ) {
    const productService = new ProductService(this.user)
    const copilotApi = new CopilotAPI(this.user.token)

    const priceResponse = await copilotApi.getPrice(
      z.string().parse(record.copilotPriceId),
    )
    if (!priceResponse) {
      await this.syncLogService.deleteQBSyncLog(record.id)
      return
    }

    try {
      await productService.webhookPriceCreated(
        { data: priceResponse },
        qbTokenInfo,
      )
    } catch (error: unknown) {
      CustomLogger.error({
        message:
          'SyncService#processProductCreate | Error while creating product',
        obj: { error, copilotId: record.copilotId },
      })
    }
  }

  private async processProductUpdate(
    record: QBSyncLogSelectSchemaType,
    qbTokenInfo: IntuitAPITokensType,
  ) {
    const productService = new ProductService(this.user)
    const copilotApi = new CopilotAPI(this.user.token)

    try {
      const product = await copilotApi.getProduct(record.copilotId)
      if (!product) {
        await this.syncLogService.deleteQBSyncLog(record.id)
        return
      }

      await productService.webhookProductUpdated({ data: product }, qbTokenInfo)
    } catch (error: unknown) {
      CustomLogger.error({
        message:
          'SyncService#processProductUpdate | Error while updating product',
        obj: { error },
      })
    }
  }

  private async processProductSync(
    record: QBSyncLogSelectSchemaType,
    qbTokenInfo: IntuitAPITokensType,
    eventType: EventType,
  ) {
    CustomLogger.info({
      message: 'SyncService#processProductSync | Processing product sync',
      obj: { eventType },
    })

    switch (eventType) {
      case EventType.CREATED:
        return await this.processProductCreate(record, qbTokenInfo)

      case EventType.UPDATED:
        return await this.processProductUpdate(record, qbTokenInfo)

      default:
        CustomLogger.error({
          message: 'SyncService#processProductSync | Unknown product type',
          obj: { eventType },
        })
        return
    }
  }

  async intiateSync(logs: QBSyncLogSelectSchemaType[]) {
    CustomLogger.info({
      message: 'SyncService#intiateSync | Initiating re-sync',
    })
    const authService = new AuthService(this.user)
    const qbTokenInfo = await authService.getQBPortalConnection(
      this.user.workspaceId,
    )
    CustomLogger.info({
      obj: { qbTokenInfo, user: this.user },
      message: 'SyncService#intiateSync | QB Token Info and User',
    })

    for (const log of logs) {
      switch (log.entityType) {
        case EntityType.INVOICE:
          CustomLogger.info({
            message: 'SyncService#intiateSync | Invoice re-sync started',
          })
          await this.processInvoiceSync(log, qbTokenInfo, log.eventType)
          break

        case EntityType.PAYMENT:
          if (log.eventType === EventType.SUCCEEDED) {
            CustomLogger.info({
              message: 'SyncService#intiateSync | Payment re-sync started',
            })
            await this.processPaymentSucceededSync(log, qbTokenInfo)
          }
          break

        case EntityType.PRODUCT:
          CustomLogger.info({
            message: 'SyncService#intiateSync | Product re-sync started',
          })
          await this.processProductSync(log, qbTokenInfo, log.eventType)
          break

        default:
          CustomLogger.error({
            message: 'SyncService#intiateSync | Unknown entity type',
            obj: { entityType: log.entityType },
          })
          break
      }
    }
  }

  async syncFailedRecords() {
    try {
      CustomLogger.info({
        message: 'SyncService#syncFailedRecords | Start re-sync process',
        obj: { workspaceId: this.user.workspaceId },
      })
      // 1. get all failed sync logs group by the entity type
      const failedSyncLogs =
        await this.syncLogService.getFailedSyncLogsByEntityType()

      if (failedSyncLogs.length === 0) {
        CustomLogger.info({
          message:
            'SyncService#syncFailedRecords | No failed sync logs found for portal',
          obj: { workspaceId: this.user.workspaceId },
        })
        return
      }

      CustomLogger.info({
        message: `Failed sync logs for portal: ${this.user.workspaceId}.`,
        obj: { failedSyncLogs },
      })

      // 2. for each log, perform the sync based on the event type and also update the sync log status to success after successful sync
      await this.intiateSync(failedSyncLogs)
      CustomLogger.info({
        message: 'SyncService#syncFailedRecords | Re-sync process completed',
        obj: { workspaceId: this.user.workspaceId },
      })
    } catch (error: unknown) {
      CustomLogger.error({
        message: 'SyncService#syncFailedRecords',
        obj: { error },
      })
      throw error
    }
  }
}
