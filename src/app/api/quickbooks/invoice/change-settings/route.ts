import { withErrorHandler } from '@/app/api/core/utils/withErrorHandler'
import { changeInvoiceSettings } from '@/app/api/quickbooks/invoice/invoice.controller'

export const POST = withErrorHandler(changeInvoiceSettings)
