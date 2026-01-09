import User from '@/app/api/core/models/User.model'
import { PortalImpactVerificationService } from '@/app/api/quickbooks/portalImpactVerification-temp/portalImpactVerification.service'
import { QBPortalConnectionSelectSchemaType } from '@/db/schema/qbPortalConnections'
import { task } from '@trigger.dev/sdk'

type CheckImpactedPortalType = {
  user: User
  portal: QBPortalConnectionSelectSchemaType
}

export const checkIncorrectlySyncedInvoiceForPortal = task({
  id: 'check-incorrectly-synced-invoice-for-portal',
  run: async (payload: CheckImpactedPortalType) => {
    console.info(
      '\nresyncFailedRecords#checkIncorrectlySyncedInvoiceForPortal :: Portal impact check started\n',
    )
    const service = new PortalImpactVerificationService(payload.user)
    await service.checkImpactedInvoiceForPortal(payload.portal)
    console.info(
      '\nresyncFailedRecords#checkIncorrectlySyncedInvoiceForPortal :: Portal impact check completed\n',
    )
  },
})
