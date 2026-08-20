import { describe, it, expect, vi, beforeEach } from 'vitest'

// Hoisted so the vi.mock factory (also hoisted) can reference these safely.
const { singletonDb, FAKE_TX } = vi.hoisted(() => {
  const FAKE_TX = { __tx: true }
  return {
    FAKE_TX,
    // Runs the callback with FAKE_TX, re-throwing on error like drizzle.
    singletonDb: {
      transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
        cb(FAKE_TX),
      ),
    },
  }
})
vi.mock('@/db', () => ({ db: singletonDb, client: {} }))

import { BaseService } from '@/app/api/core/services/base.service'
import User from '@/app/api/core/models/User.model'

// Subclass to reach the protected members under test.
class TestService extends BaseService {
  get currentDb() {
    return this.db
  }
  run<T>(fn: () => Promise<T>, services: BaseService[] = []) {
    return this.withTransaction(() => fn(), services)
  }
}

const makeService = () => new TestService({} as User)

describe('BaseService.withTransaction', () => {
  beforeEach(() => vi.clearAllMocks())

  it('points this.db at the tx during fn and restores it after success', async () => {
    const service = makeService()
    expect(service.currentDb).toBe(singletonDb)

    let dbDuringFn: unknown
    await service.run(async () => {
      dbDuringFn = service.currentDb
    })

    expect(dbDuringFn).toBe(FAKE_TX)
    expect(service.currentDb).toBe(singletonDb) // restored
  })

  it('also binds and restores extra services passed in', async () => {
    const service = makeService()
    const nested = makeService()

    let nestedDbDuringFn: unknown
    await service.run(async () => {
      nestedDbDuringFn = nested.currentDb
    }, [nested])

    expect(nestedDbDuringFn).toBe(FAKE_TX) // nested joined the tx
    expect(nested.currentDb).toBe(singletonDb) // restored
  })

  it('restores every bound service even when fn throws', async () => {
    const service = makeService()
    const nested = makeService()

    await expect(
      service.run(async () => {
        throw new Error('boom')
      }, [nested]),
    ).rejects.toThrow('boom')

    // The finally wraps the transaction, so neither is left on a dead handle.
    expect(service.currentDb).toBe(singletonDb)
    expect(nested.currentDb).toBe(singletonDb)
  })

  it('returns the value produced inside the transaction', async () => {
    const service = makeService()
    const result = await service.run(async () => 'done')
    expect(result).toBe('done')
  })
})
