import { QBInvoiceSync } from '@/db/schema/qbInvoiceSync'
import { QBPaymentSync } from '@/db/schema/qbPaymentSync'
import { QBProductSync } from '@/db/schema/qbProductSync'
import { QBPortalConnection } from '@/db/schema/qbPortalConnections'
import { QBConnectionLogs } from '@/db/schema/qbConnectionLogs'
import { QBCustomers } from '@/db/schema/qbCustomers'
import { QBSetting } from '@/db/schema/qbSettings'
import { QBSyncLog } from '@/db/schema/qbSyncLogs'
import { PortalImpactVerification } from '@/db/schema/portalImpactVerification'

export const schema = {
  QBInvoiceSync,
  QBPaymentSync,
  QBProductSync,
  QBPortalConnection,
  QBConnectionLogs,
  QBCustomers,
  QBSetting,
  QBSyncLog,
  PortalImpactVerification,
}
