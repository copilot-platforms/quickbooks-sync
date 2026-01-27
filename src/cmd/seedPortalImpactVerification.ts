import {
  PortalImpactCreateSchemaType,
  PortalImpactVerification,
} from '@/db/schema/portalImpactVerification'
import { db } from '@/db'
import { impacteWorkspaces } from '@/config'
;(async function run() {
  console.info('Seeding Portal Impact Verification table...')

  const portalIds = impacteWorkspaces.split(',')
  const insertPayload: PortalImpactCreateSchemaType[] = portalIds.map((id) => ({
    portalId: id,
  }))
  await db
    .insert(PortalImpactVerification)
    .values(insertPayload)
    .onConflictDoNothing({ target: PortalImpactVerification.portalId })

  console.info('Seeding completed 🌱')
  process.exit(1)
})()
