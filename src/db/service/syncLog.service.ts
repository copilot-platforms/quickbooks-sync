'use server'
import { EntityType, EventType, LogStatus } from '@/app/api/core/types/log'
import { db } from '@/db'
import { QBSyncLog } from '@/db/schema/qbSyncLogs'
import { and, eq, inArray, isNull } from 'drizzle-orm'

// Which of these invoices already have a recorded absorbed-fee expense in QBO.
// A SUCCESS PAYMENT/SUCCEEDED row exists only if the fee Purchase was created.
export const getInvoiceNumbersWithRecordedFee = async (
  portalId: string,
  invoiceNumbers: string[],
): Promise<Set<string>> => {
  if (invoiceNumbers.length === 0) return new Set()

  const rows = await db
    .select({ invoiceNumber: QBSyncLog.invoiceNumber })
    .from(QBSyncLog)
    .where(
      and(
        eq(QBSyncLog.portalId, portalId),
        eq(QBSyncLog.entityType, EntityType.PAYMENT),
        eq(QBSyncLog.eventType, EventType.SUCCEEDED),
        eq(QBSyncLog.status, LogStatus.SUCCESS),
        inArray(QBSyncLog.invoiceNumber, invoiceNumbers),
        isNull(QBSyncLog.deletedAt),
      ),
    )

  return new Set(
    rows
      .map((row) => row.invoiceNumber)
      .filter((invoiceNumber): invoiceNumber is string =>
        Boolean(invoiceNumber),
      ),
  )
}
