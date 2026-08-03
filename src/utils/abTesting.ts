import { abFeatureTestingPortals } from '@/config'

/**
 * Whether a portal may use the bank deposit feature during its incremental
 * rollout. An empty/unset allowlist means the feature is on for all portals;
 * otherwise only listed portals get it.
 */
export function isPortalInBankDepositABTest(portalId: string): boolean {
  if (abFeatureTestingPortals.length === 0) return true
  return abFeatureTestingPortals.includes(portalId)
}
