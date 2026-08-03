// Drives the bank-deposit AB gate mocked in test/integration/setup.ts. The mock
// reads its allowlist from a globalThis-pinned holder (the real allowlist is
// env-parsed at module load and can't be varied per-test). `null` = feature on
// for all portals. Always reset in afterEach so state doesn't leak across files.
const AB_GATE_GLOBAL_KEY = '__qbsync_ab_test_gate__'
type ABGate = { allowlist: string[] | null }
const ref = globalThis as unknown as Record<string, ABGate | undefined>
ref[AB_GATE_GLOBAL_KEY] ??= { allowlist: null }

export const abTestGate = {
  setAllowlist(portalIds: string[] | null) {
    ref[AB_GATE_GLOBAL_KEY]!.allowlist = portalIds
  },
  reset() {
    ref[AB_GATE_GLOBAL_KEY]!.allowlist = null
  },
}
