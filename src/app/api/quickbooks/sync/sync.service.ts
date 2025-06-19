import { BaseService } from '@/app/api/core/services/base.service'
import { SyncLogService } from '@/app/api/quickbooks/syncLog/syncLog.service'
import { InvoiceService } from '@/app/api/quickbooks/invoice/invoice.service'
import { AuthService } from '@/app/api/quickbooks/auth/auth.service'
import IntuitAPI, { IntuitAPITokensType } from '@/utils/intuitAPI'
import { InvoiceResponse, ProductsResponse, WhereClause } from '@/type/common'
import { CopilotAPI } from '@/utils/copilotAPI'
import { EntityType, EventType, LogStatus } from '@/app/api/core/types/log'
import postgres from 'postgres'
import User from '@/app/api/core/models/User.model'
import { PaymentService } from '@/app/api/quickbooks/payment/payment.service'
import dayjs from 'dayjs'
import { MAX_PRODUCT_LIST_LIMIT } from '@/app/api/core/constants/limit'
import { convert } from 'html-to-text'
import { QBProductSync } from '@/db/schema/qbProductSync'
import { ProductService } from '@/app/api/quickbooks/product/product.service'
import { and, eq, isNull, or } from 'drizzle-orm'
import { bottleneck } from '@/utils/bottleneck'

export class SyncService extends BaseService {
  private invoiceService: InvoiceService
  private syncLogService: SyncLogService

  constructor(user: User) {
    super(user)
    this.invoiceService = new InvoiceService(user)
    this.syncLogService = new SyncLogService(user)
  }

  private async processInvoiceSync(
    records: Record<string, any>[],
    qbTokenInfo: IntuitAPITokensType,
    invoices: InvoiceResponse[] | undefined,
    eventType: EventType,
  ) {
    const invoiceIds = records.map((e: any) => e.copilotId)

    if (invoices) {
      await Promise.all(
        invoices.map(async (invoice) => {
          if (invoiceIds.includes(invoice.id)) {
            switch (eventType) {
              case EventType.CREATED:
                await this.invoiceService.webhookInvoiceCreated(
                  { data: invoice },
                  qbTokenInfo,
                )
                break

              case EventType.PAID:
                await this.invoiceService.webhookInvoicePaid(
                  { data: invoice },
                  qbTokenInfo,
                )
                break

              case EventType.VOIDED:
                await this.invoiceService.webhookInvoiceVoided(
                  { data: invoice },
                  qbTokenInfo,
                )
                break

              default:
                console.error(
                  'SyncLogService#processInvoiceSync | Unknown event type: ',
                  eventType,
                )
                break
            }
          }
        }),
      )
    }
  }

  private async processPaymentSucceededSync(
    records: Record<string, any>[],
    qbTokenInfo: IntuitAPITokensType,
  ) {
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
  }

  private async processProductSync(
    records: Record<string, any>[],
    qbTokenInfo: IntuitAPITokensType,
    products: ProductsResponse | undefined,
    eventType: EventType,
  ) {
    const productIds = records.map((e: any) => e.copilotId)
    const intuitApi = new IntuitAPI(qbTokenInfo)
    const copilotApi = new CopilotAPI(this.user.token)
    const productService = new ProductService(this.user)

    if (products && products.data) {
      const productProcessPromises = []
      for (const product of products.data) {
        if (productIds.includes(product.id)) {
          productProcessPromises.push(
            bottleneck.schedule(async () => {
              switch (eventType) {
                case EventType.CREATED:
                  // NOTE: Followed thorough flow of creating product in QB as the item creation failed can it is effected by price or product webhooks
                  const priceInfo = await copilotApi.getPrices(product.id)
                  const singlePrice = priceInfo?.data?.[0] // only get single price as first created product has firs single price
                  if (singlePrice) {
                    const productDescription = convert(product.description)

                    // create item in QB
                    const item = await productService.createItemInQB(
                      {
                        productName: product.name,
                        unitPrice: singlePrice.amount,
                        incomeAccRefVal: qbTokenInfo.incomeAccountRef,
                        productDescription,
                      },
                      intuitApi,
                    )

                    // update mapping table
                    const conditions = and(
                      eq(QBProductSync.portalId, this.user.workspaceId),
                      or(
                        eq(QBProductSync.productId, product.id),
                        eq(QBProductSync.priceId, singlePrice.id),
                      ),
                      isNull(QBProductSync.qbItemId),
                      isNull(QBProductSync.qbSyncToken),
                    ) as WhereClause
                    await productService.updateOrCreateQBProduct(
                      {
                        portalId: this.user.workspaceId,
                        productId: product.id,
                        priceId: singlePrice.id,
                        name: product.name,
                        description: productDescription,
                        qbItemId: item.Id,
                        qbSyncToken: item.SyncToken,
                      },
                      conditions,
                    )

                    // update the sync log
                    await this.syncLogService.updateOrCreateQBSyncLog({
                      portalId: this.user.workspaceId,
                      entityType: EntityType.PRODUCT,
                      eventType: EventType.CREATED,
                      status: LogStatus.SUCCESS,
                      copilotId: product.id,
                      quickbooksId: item.Id,
                      syncDate: dayjs().format('YYYY-MM-DD'),
                      syncTime: dayjs().format('HH:mm:ss'),
                    })
                  }
                  break

                case EventType.UPDATED:
                  await productService.webhookProductUpdated(
                    { data: product },
                    qbTokenInfo,
                  )
                  break

                default:
                  console.error(
                    'SyncLogService#processProductSync | Unknown product status: ',
                    product.status,
                  )
                  break
              }
            }),
          )
        }
      }

      await Promise.all(productProcessPromises)
    }
  }

  async intiateSync(logs: postgres.RowList<Record<string, any>[]>) {
    const authService = new AuthService(this.user)
    const qbTokenInfo = await authService.getQBToken(this.user.workspaceId)
    const copilotApi = new CopilotAPI(this.user.token)
    const invoices = await copilotApi.getInvoices()
    const products = await copilotApi.getProducts(
      undefined,
      undefined,
      MAX_PRODUCT_LIST_LIMIT,
    )

    for (const log of logs) {
      switch (log.entityType) {
        case EntityType.INVOICE:
          await this.processInvoiceSync(
            log.records,
            qbTokenInfo,
            invoices,
            log.eventType,
          )
          break

        case EntityType.PAYMENT:
          if (log.eventType === EventType.SUCCEEDED) {
            await this.processPaymentSucceededSync(log.records, qbTokenInfo)
          }
          break

        case EntityType.PRODUCT:
          await this.processProductSync(
            log.records,
            qbTokenInfo,
            products,
            log.eventType,
          )
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
    console.info('\n##### Start the re-sync process #####\n')
    // 1. get all failed sync logs group by the entity type
    const failedSyncLogs =
      await this.syncLogService.getFailedSyncLogsByEntityType()

    console.info('Fetched failed logs', failedSyncLogs)
    // 2. for each log, perform the sync based on the event type and also update the sync log status to success after successful sync
    await this.intiateSync(failedSyncLogs)
    console.info('\n##### Re-sync process completed#####\n')
  }
}
