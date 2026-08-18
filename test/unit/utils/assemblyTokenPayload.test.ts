import { describe, it, expect, vi, beforeEach } from 'vitest'

// Simulate the real @assembly-js/node-sdk v4 contract: assemblyApi() returns a
// fresh, per-call client whose getTokenPayload() resolves the payload derived
// from THIS call's token (captured in a closure), never shared global state.
// A staggered delay inside getTokenPayload forces concurrent calls to resolve
// out of order — so any cross-call state leak in AssemblyTokenPayload would
// surface as a mismatched workspaceId.
vi.mock('@assembly-js/node-sdk', () => ({
  assemblyApi: vi.fn(async ({ token }: { token: string }) => {
    const payload = JSON.parse(token) as {
      workspaceId: string
      delayMs: number
    }
    return {
      getTokenPayload: async () => {
        await new Promise((resolve) => setTimeout(resolve, payload.delayMs))
        return { workspaceId: payload.workspaceId }
      },
    }
  }),
}))

import { assemblyApi } from '@assembly-js/node-sdk'
import { AssemblyTokenPayload } from '@/utils/assemblyTokenPayload'

// In this test a "token" is just a JSON string carrying the workspace it belongs
// to and how long its decode should take.
const makeToken = (workspaceId: string, delayMs: number) =>
  JSON.stringify({ workspaceId, delayMs })

describe('AssemblyTokenPayload.getTokenPayload — concurrency isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns the matching workspaceId for a single call', async () => {
    const payload = await new AssemblyTokenPayload().getTokenPayload(
      makeToken('ws-solo', 0),
    )
    expect(payload?.workspaceId).toBe('ws-solo')
  })

  it('keeps each workspace isolated across interleaved concurrent calls', async () => {
    // 20 different workspaces, fired together. Earlier calls are given LONGER
    // delays so completion order is the reverse of call order — maximising
    // interleaving at both await points inside getTokenPayload.
    const count = 20
    const workspaceIds = Array.from({ length: count }, (_, i) => `ws-${i}`)

    const results = await Promise.all(
      workspaceIds.map((workspaceId, i) =>
        new AssemblyTokenPayload().getTokenPayload(
          makeToken(workspaceId, (count - i) * 2),
        ),
      ),
    )

    // Every call must return its OWN workspace — no bleed between requests.
    results.forEach((payload, i) => {
      expect(payload?.workspaceId).toBe(workspaceIds[i])
    })
  })

  it('builds one independent SDK per call (no shared client)', async () => {
    await Promise.all([
      new AssemblyTokenPayload().getTokenPayload(makeToken('ws-a', 6)),
      new AssemblyTokenPayload().getTokenPayload(makeToken('ws-b', 3)),
      new AssemblyTokenPayload().getTokenPayload(makeToken('ws-c', 0)),
    ])

    // assemblyApi is invoked once per call, each with that call's own token.
    expect(assemblyApi).toHaveBeenCalledTimes(3)
    const tokensSeen = (
      assemblyApi as unknown as ReturnType<typeof vi.fn>
    ).mock.calls.map(([arg]) => JSON.parse(arg.token).workspaceId)
    expect(tokensSeen.sort()).toEqual(['ws-a', 'ws-b', 'ws-c'])
  })
})
