import { BaseService } from '@/app/api/core/services/base.service'
import {
  CustomSyncLogRecordType,
  CustomSyncLogType,
  SyncLogService,
} from '@/app/api/quickbooks/syncLog/syncLog.service'
import { InvoiceService } from '@/app/api/quickbooks/invoice/invoice.service'
import { AuthService } from '@/app/api/quickbooks/auth/auth.service'
import IntuitAPI, { IntuitAPITokensType } from '@/utils/intuitAPI'
import { CopilotAPI } from '@/utils/copilotAPI'
import { EntityType, EventType } from '@/app/api/core/types/log'
import postgres from 'postgres'
import User from '@/app/api/core/models/User.model'
import { PaymentService } from '@/app/api/quickbooks/payment/payment.service'
import dayjs from 'dayjs'
import { ProductService } from '@/app/api/quickbooks/product/product.service'
import { bottleneck } from '@/utils/bottleneck'
import { infoLog } from '@/utils/logger'

export class SyncService extends BaseService {
  private invoiceService: InvoiceService
  private syncLogService: SyncLogService

  constructor(user: User) {
    super(user)
    this.invoiceService = new InvoiceService(user)
    this.syncLogService = new SyncLogService(user)
  }

  private async processInvoiceCreate(
    logRecords: CustomSyncLogRecordType[],
    qbTokenInfo: IntuitAPITokensType,
  ) {
    const copilotApi = new CopilotAPI(this.user.token)
    const invoicePromises = []

    for (const record of logRecords) {
      invoicePromises.push(
        bottleneck.schedule(async () => {
          try {
            // get invoice from Copilot API
            const invoice = await copilotApi.getInvoice(record.copilotId)
            if (!invoice) return

            // start re-sync process
            await this.invoiceService.webhookInvoiceCreated(
              { data: invoice },
              qbTokenInfo,
            )
          } catch (error: unknown) {
            console.error(
              `SyncService#processInvoiceCreate | Error = ${error} | Invoice Number: ${record.invoiceNumber}`,
            )
          }
        }),
      )
    }
    await Promise.all(invoicePromises)
  }

  private async processInvoicePaid(
    logRecords: CustomSyncLogRecordType[],
    qbTokenInfo: IntuitAPITokensType,
  ) {
    const copilotApi = new CopilotAPI(this.user.token)
    const invoicePromises = []

    for (const record of logRecords) {
      invoicePromises.push(
        bottleneck.schedule(async () => {
          try {
            // get invoice from Copilot API
            const invoice = await copilotApi.getInvoice(record.copilotId)
            if (!invoice) return

            // start re-sync process
            await this.invoiceService.webhookInvoicePaid(
              { data: invoice },
              qbTokenInfo,
            )
          } catch (error: unknown) {
            console.error(
              `SyncService#processInvoicePaid | Error = ${error} | Invoice Number: ${record.invoiceNumber}`,
            )
          }
        }),
      )
    }
    await Promise.all(invoicePromises)
  }

  private async processInvoiceVoided(
    logRecords: CustomSyncLogRecordType[],
    qbTokenInfo: IntuitAPITokensType,
  ) {
    await Promise.all(
      logRecords.map(async (record) => {
        try {
          const invoiceSync = await this.invoiceService.getInvoiceByNumber(
            record.invoiceNumber,
          )
          if (!invoiceSync) {
            console.warn(
              `SyncService#processInvoiceVoided | No invoice found for number: ${record.invoiceNumber}`,
            )
            return
          }

          if (!invoiceSync.customer) {
            console.warn(
              `SyncService#processInvoiceVoided | No customer found for number: ${record.invoiceNumber}`,
            )
            return
          }

          const invoice = {
            id: record.copilotId,
            number: record.invoiceNumber,
            total: record.amount / 100, // assuming amount is in cents
            clientId: invoiceSync.customer.clientId || '',
            companyId: invoiceSync.customer.companyId || '',
          }
          await this.invoiceService.webhookInvoiceVoided(invoice, qbTokenInfo)
        } catch (error: unknown) {
          console.error(
            `SyncService#processInvoiceVoided | Error = ${error} | Invoice Number: ${record.invoiceNumber}`,
          )
        }
      }),
    )
  }

  private async processInvoiceDeleted(
    logRecords: CustomSyncLogRecordType[],
    qbTokenInfo: IntuitAPITokensType,
  ) {
    await Promise.all(
      logRecords.map(async (record) => {
        try {
          const invoiceSync = await this.invoiceService.getInvoiceByNumber(
            record.invoiceNumber,
          )
          if (!invoiceSync) {
            console.warn(
              `SyncService#processInvoiceVoided | No invoice found for number: ${record.invoiceNumber}`,
            )
            return
          }

          if (!invoiceSync.customer) {
            console.warn(
              `SyncService#processInvoiceVoided | No customer found for number: ${record.invoiceNumber}`,
            )
            return
          }

          const invoice = {
            id: record.copilotId,
            number: record.invoiceNumber,
            total: record.amount / 100, // assuming amount is in cents
            clientId: invoiceSync.customer.clientId || '',
            companyId: invoiceSync.customer.companyId || '',
          }

          await this.invoiceService.handleInvoiceDeleted(invoice, qbTokenInfo)
        } catch (error: unknown) {
          console.error(
            `SyncService#processInvoiceDeleted | Error = ${error} | Invoice Number: ${record.invoiceNumber}`,
          )
        }
      }),
    )
  }

  private async processInvoiceSync(
    records: CustomSyncLogRecordType[],
    qbTokenInfo: IntuitAPITokensType,
    eventType: EventType,
  ) {
    console.info(`syncService#processInvoiceSync | eventType: ${eventType}`)

    switch (eventType) {
      case EventType.CREATED:
        await this.processInvoiceCreate(records, qbTokenInfo)
        break

      case EventType.PAID:
        await this.processInvoicePaid(records, qbTokenInfo)
        break

      case EventType.VOIDED:
        await this.processInvoiceVoided(records, qbTokenInfo)
        break

      case EventType.DELETED:
        await this.processInvoiceDeleted(records, qbTokenInfo)
        break

      default:
        console.error(
          'SyncLogService#processInvoiceSync | Unknown event type: ',
          eventType,
        )
        break
    }
  }

  private async processPaymentSucceededSync(
    records: CustomSyncLogRecordType[],
    qbTokenInfo: IntuitAPITokensType,
  ) {
    try {
      infoLog({
        message: 'syncService#processPaymentSucceededSync | records: ',
        obj: records,
      })

      await Promise.all(
        records.map(async (record) => {
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
                Amount: record.amount / 100,
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
        }),
      )
    } catch (error: unknown) {
      console.error('SyncService#processPaymentSucceededSync | Error =', error)
    }
  }

  private async processProductCreate(
    logRecords: CustomSyncLogRecordType[],
    qbTokenInfo: IntuitAPITokensType,
  ) {
    const productService = new ProductService(this.user)
    const copilotApi = new CopilotAPI(this.user.token)
    const productProcessPromises = []

    for (const record of logRecords) {
      productProcessPromises.push(
        bottleneck.schedule(async () => {
          if (!record.copilotPriceId) return

          const priceResponse = await copilotApi.getPrice(record.copilotPriceId)
          if (!priceResponse) return

          try {
            await productService.webhookPriceCreated(
              { data: priceResponse },
              qbTokenInfo,
            )
          } catch (error: unknown) {
            console.error(
              `SyncService#processProductCreate | Error for product with ID: ${record.copilotId}. Error: ${error}`,
            )
          }
        }),
      )
    }
    await Promise.all(productProcessPromises)
  }

  private async processProductUpdate(
    logRecords: CustomSyncLogRecordType[],
    qbTokenInfo: IntuitAPITokensType,
  ) {
    const productService = new ProductService(this.user)
    const copilotApi = new CopilotAPI(this.user.token)
    const productProcessPromises = []

    try {
      for (const record of logRecords) {
        productProcessPromises.push(
          bottleneck.schedule(async () => {
            const product = await copilotApi.getProduct(record.copilotId)
            if (!product) return

            await productService.webhookProductUpdated(
              { data: product },
              qbTokenInfo,
            )
          }),
        )
      }
      await Promise.all(productProcessPromises)
    } catch (error: unknown) {
      console.error('SyncService#processProductUpdate | Error =', error)
    }
  }

  private async processProductSync(
    records: CustomSyncLogRecordType[],
    qbTokenInfo: IntuitAPITokensType,
    eventType: EventType,
  ) {
    console.info(`syncService#processProductSync | eventType: ${eventType}`)

    switch (eventType) {
      case EventType.CREATED:
        return await this.processProductCreate(records, qbTokenInfo)

      case EventType.UPDATED:
        return await this.processProductUpdate(records, qbTokenInfo)

      default:
        console.error(
          'SyncLogService#processProductSync | Unknown product type: ',
          eventType,
        )
        return
    }
  }

  async intiateSync(logs: postgres.RowList<CustomSyncLogType[]>) {
    console.info('\n###### Initiating re-sync ######')
    const authService = new AuthService(this.user)
    const qbTokenInfo = await authService.getQBPortalConnection(
      this.user.workspaceId,
    )
    infoLog({
      obj: { qbTokenInfo, user: this.user },
      message: 'SyncService#intiateSync | QB Token Info and User',
    })

    for (const log of logs) {
      switch (log.entityType) {
        case EntityType.INVOICE:
          console.info('Invoice re-sync started')
          await this.processInvoiceSync(log.records, qbTokenInfo, log.eventType)
          break

        case EntityType.PAYMENT:
          if (log.eventType === EventType.SUCCEEDED) {
            console.info('Payment re-sync started')
            await this.processPaymentSucceededSync(log.records, qbTokenInfo)
          }
          break

        case EntityType.PRODUCT:
          console.info('product re-sync started')
          await this.processProductSync(log.records, qbTokenInfo, log.eventType)
          break

        default:
          console.error(
            'SyncLogService#processSync | Unknown entity type: ',
            log.entityType,
          )
          break
      }
    }
  }

  async syncFailedRecords() {
    try {
      console.info(
        `\n##### Start the re-sync process for Portal: ${this.user.workspaceId} #####`,
      )
      // 1. get all failed sync logs group by the entity type
      const failedSyncLogs =
        await this.syncLogService.getFailedSyncLogsByEntityType()

      if (failedSyncLogs.length === 0) {
        console.info(
          `No failed sync logs found for portal ${this.user.workspaceId}`,
        )
        return
      }

      infoLog({
        message: `Failed sync logs for portal: ${this.user.workspaceId}.`,
        obj: { failedSyncLogs },
      })

      // 2. for each log, perform the sync based on the event type and also update the sync log status to success after successful sync
      await this.intiateSync(failedSyncLogs)
      console.info(
        `##### Re-sync process completed for Portal: ${this.user.workspaceId} #####\n`,
      )
    } catch (error: unknown) {
      console.error('SyncService#syncFailedRecords | Error =', error)
      throw error
    }
  }
}
