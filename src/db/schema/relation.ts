import { QBCustomerRelations } from '@/db/schema/qbCustomers'
import { QBInvoiceSyncRelations } from '@/db/schema/qbInvoiceSync'
import { QBPortalConnectionRelations } from '@/db/schema/qbPortalConnections'
import { QBSettingRelations } from '@/db/schema/qbSettings'

export const relation = {
  QBPortalConnectionRelations,
  QBSettingRelations,
  QBCustomerRelations,
  QBInvoiceSyncRelations,
}
