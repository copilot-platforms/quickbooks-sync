import { describe, it, expect, afterEach, vi } from 'vitest'

// abFeatureTestingPortals is parsed from the env var at module load, so each
// case stubs the env, resets the module registry, and re-imports to pick up
// the fresh parse.
async function loadGate(envValue?: string) {
  vi.resetModules()
  if (envValue === undefined) {
    vi.stubEnv('AB_FEATURE_TESTING_PORTALS', '')
  } else {
    vi.stubEnv('AB_FEATURE_TESTING_PORTALS', envValue)
  }
  const { isPortalInBankDepositABTest } = await import('@/utils/abTesting')
  return isPortalInBankDepositABTest
}

describe('isPortalInBankDepositABTest', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('allows every portal when the allowlist is unset', async () => {
    const isInTest = await loadGate(undefined)
    expect(isInTest('portal-abc')).toBe(true)
  })

  it('allows every portal when the allowlist is empty', async () => {
    const isInTest = await loadGate('')
    expect(isInTest('portal-abc')).toBe(true)
  })

  it('allows a portal that is on the allowlist', async () => {
    const isInTest = await loadGate('portal-abc,portal-def')
    expect(isInTest('portal-abc')).toBe(true)
    expect(isInTest('portal-def')).toBe(true)
  })

  it('blocks a portal that is not on the allowlist', async () => {
    const isInTest = await loadGate('portal-abc,portal-def')
    expect(isInTest('portal-xyz')).toBe(false)
  })

  it('ignores surrounding whitespace and empty entries in the allowlist', async () => {
    const isInTest = await loadGate('  portal-abc , , portal-def ,')
    expect(isInTest('portal-abc')).toBe(true)
    expect(isInTest('portal-def')).toBe(true)
    expect(isInTest('portal-xyz')).toBe(false)
  })
})
