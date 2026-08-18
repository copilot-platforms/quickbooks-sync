import APIError from '@/app/api/core/exceptions/api'
import { EntityType, LogStatus } from '@/app/api/core/types/log'
import { BaseService } from '@/app/api/core/services/base.service'
import { withRetry } from '@/app/api/core/utils/withRetry'
import { AuthService } from '@/app/api/quickbooks/auth/auth.service'
import { InvoiceService } from '@/app/api/quickbooks/invoice/invoice.service'
import { QBSyncLog } from '@/db/schema/qbSyncLogs'
import { StatusableError } from '@/type/CopilotApiError'
import { AssemblyAPI } from '@/utils/assemblyAPI'
import CustomLogger from '@/utils/logger'
import { and, eq, gte, or, sql } from 'drizzle-orm'
import httpStatus from 'http-status'
import { InvoiceStatus } from '@/app/api/core/types/invoice'

export class SyncMissedInvoicesService extends BaseService {
  async _syncMissedInvoicesForPortal() {
    try {
      console.info(
        `SyncMissedInvoicesService#syncMissedInvoicesForPortal :: Processing portal: ${this.user.workspaceId}`,
      )

      // 1. Query missed payment records (payments with no corresponding invoice sync log)
      const missedRecords = await this.getMissedPaymentRecords()

      if (missedRecords.length === 0) {
        console.info(`No missed records for portal ${this.user.workspaceId}`)
        return
      }

      console.info(
        `Found ${missedRecords.length} missed invoice records for portal ${this.user.workspaceId}`,
      )

      // 2. Fetch all invoices from Copilot for this portal (single API call)
      const copilotApi = new AssemblyAPI(this.user.workspaceId)
      const allInvoices = await copilotApi.getInvoices(this.user.workspaceId)
      const allPayments = await copilotApi.getPayments()

      if (!allInvoices || allInvoices.length === 0) {
        console.info(
          `No invoices found in Copilot for portal ${this.user.workspaceId}`,
        )
        return
      }

      // 3. Get QB connection tokens
      const authService = new AuthService(this.user)
      const qbTokenInfo = await authService.getQBPortalConnection(
        this.user.workspaceId,
      )

      if (!qbTokenInfo.accessToken || !qbTokenInfo.refreshToken) {
        console.info(
          `No access token found for portal: ${this.user.workspaceId}`,
        )
        return
      }

      // 4. Process each missed record
      const invoiceService = new InvoiceService(this.user)
      let successCount = 0,
        failCount = 0,
        skipCount = 0

      for (const record of missedRecords) {
        const payment = allPayments?.data?.find(
          (payment) => payment.id === record.copilotId,
        )

        if (!payment) {
          console.info(
            `Payment not found in Copilot for id: ${record.copilotId}. Skipping.`,
          )
          skipCount++
          continue
        }

        const invoice = allInvoices.find((inv) => inv.id === payment.invoiceId)

        if (!invoice) {
          console.info(
            `Invoice not found in Copilot for number: ${record.invoiceNumber}. Skipping.`,
          )
          skipCount++
          continue
        }

        try {
          // check if the invoice exists in QBO
          const invoiceCheck = await invoiceService.checkIfInvoiceExistsInQBO(
            { data: invoice },
            qbTokenInfo,
          )

          if (!invoiceCheck.exists) {
            await invoiceService.webhookInvoiceCreated(
              { data: invoice },
              qbTokenInfo,
            )

            if (invoice.status === InvoiceStatus.VOID) {
              await invoiceService.webhookInvoiceVoided(invoice, qbTokenInfo)
            }
          } else {
            console.info(
              `Invoice already exists in QBO for number: ${record.invoiceNumber}. Skipping.`,
            )
            skipCount++
          }

          // Update the payment sync log record with the invoice number if it was missing
          if (!record.invoiceNumber) {
            await this.db
              .update(QBSyncLog)
              .set({ invoiceNumber: invoice.number })
              .where(eq(QBSyncLog.id, record.id))
            console.info(
              `Updated payment record ${record.id} with invoice_number: ${invoice.number}`,
            )

            if (invoiceCheck.exists) continue
          }

          successCount++
          console.info(`Synced invoice: ${invoice.number}`)
        } catch (error) {
          failCount++
          CustomLogger.error({
            message: `SyncMissedInvoicesService#syncMissedInvoicesForPortal | Failed to sync invoice: ${record.invoiceNumber}`,
            obj: { error, invoiceNumber: record.invoiceNumber },
          })
        }
      }

      console.info(
        `Portal ${this.user.workspaceId} summary: ${successCount} synced, ${failCount} failed, ${skipCount} skipped`,
      )
    } catch (error: unknown) {
      if (error instanceof APIError) {
        throw error
      }
      const assemblyError = error as StatusableError
      const status = assemblyError.status || httpStatus.BAD_REQUEST
      if (status === httpStatus.FORBIDDEN) {
        console.info(
          `Assembly sdk returns forbidden for the portal ${this.user.workspaceId}`,
        )
        return
      }
      throw error
    }
  }

  private async getMissedPaymentRecords() {
    return await this.db
      .select()
      .from(QBSyncLog)
      .where(
        and(
          eq(QBSyncLog.portalId, this.user.workspaceId),
          eq(QBSyncLog.entityType, EntityType.PAYMENT),
          eq(QBSyncLog.status, LogStatus.SUCCESS),
          gte(QBSyncLog.createdAt, new Date('2026-01-01')),
          or(
            sql`${QBSyncLog.invoiceNumber} NOT IN (
              SELECT ${QBSyncLog.invoiceNumber} FROM ${QBSyncLog}
              WHERE ${QBSyncLog.entityType} = ${EntityType.INVOICE}
              and ${QBSyncLog.portalId} = ${this.user.workspaceId}
            )`,
            eq(QBSyncLog.invoiceNumber, ''),
          ),
        ),
      )
      .orderBy(QBSyncLog.createdAt)
  }

  private wrapWithRetry<Args extends unknown[], R>(
    fn: (...args: Args) => Promise<R>,
  ): (...args: Args) => Promise<R> {
    return (...args: Args): Promise<R> => withRetry(fn.bind(this), args)
  }

  syncMissedInvoicesForPortal = this.wrapWithRetry(
    this._syncMissedInvoicesForPortal,
  )
}
