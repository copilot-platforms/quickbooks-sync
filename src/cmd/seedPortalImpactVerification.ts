import {
  PortalImpactCreateSchemaType,
  PortalImpactVerification,
} from '@/db/schema/portalImpactVerification'
import { db } from '@/db'
;(async function run() {
  console.info('Seeding Portal Impact Verification table...')

  const portalIds = [
    'us-east-1_PDNTSQlES',
    'sDJgBX5-M',
    '4qXQ8Unrp',
    'us-east-1_rFmlqkUoF',
    'oCw1DkV9p',
    'XK16s-lzp',
    'us-east-1_N6QzWpepP',
    'Li3VGf79M',
    'nQCenew9p',
    'WYeFtTN-p',
  ]
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
