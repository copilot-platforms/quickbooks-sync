import { QBInvoiceSync } from '@/db/schema/qbInvoiceSync'
import { QBPaymentSync } from '@/db/schema/qbPaymentSync'
import { QBProductSync } from '@/db/schema/qbProductSync'
import { QBTokens } from '@/db/schema/qbTokens'
import { QBConnectionLogs } from '@/db/schema/qbConnectionLogs'
import { QBCustomers } from '@/db/schema/qbCustomers'
import { QBExpenseSync } from '@/db/schema/qbExpenseSync'
import { QBSetting } from '@/db/schema/qbSettings'
import { QBSyncLog } from '@/db/schema/qbSyncLogs'

export const schema = {
  QBInvoiceSync,
  QBPaymentSync,
  QBProductSync,
  QBTokens,
  QBConnectionLogs,
  QBCustomers,
  QBExpenseSync,
  QBSetting,
  QBSyncLog,
}
