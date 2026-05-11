import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { getFetcher, postFetcher } from '@/helper/fetch.helper'
import { HttpFetchError } from '@/utils/error'

const okJson = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })

describe('fetch.helper', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  describe('getFetcher', () => {
    it('returns parsed JSON on a 2xx response', async () => {
      ;(fetch as any).mockResolvedValueOnce(okJson({ ok: true, n: 1 }))

      const result = await getFetcher('https://example.com/x', {
        Authorization: 'Bearer t',
      })

      expect(result).toEqual({ ok: true, n: 1 })
    })

    it('passes an AbortSignal to fetch', async () => {
      ;(fetch as any).mockResolvedValueOnce(okJson({}))

      await getFetcher('https://example.com/x', {})

      const init = (fetch as any).mock.calls[0][1] as RequestInit
      expect(init.signal).toBeInstanceOf(AbortSignal)
    })

    it('captures status, url, and parsed body on the thrown error', async () => {
      ;(fetch as any).mockResolvedValueOnce(
        new Response('{"err":"boom"}', {
          status: 500,
          statusText: 'Server Error',
          headers: { 'content-type': 'application/json' },
        }),
      )

      const url = 'https://example.com/y'
      try {
        await getFetcher(url, {})
        throw new Error('expected throw')
      } catch (e) {
        expect(e).toBeInstanceOf(HttpFetchError)
        const err = e as HttpFetchError
        expect(err.status).toBe(500)
        expect(err.statusText).toBe('Server Error')
        expect(err.url).toBe(url)
        expect(err.body).toEqual({ err: 'boom' })
      }
    })

    it('surfaces Intuit Fault.Error detail into error.message', async () => {
      ;(fetch as any).mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            Fault: {
              Error: [
                {
                  Message: 'Required param missing',
                  Detail: 'Name is required',
                  code: '2020',
                },
              ],
              type: 'ValidationFault',
            },
          }),
          {
            status: 400,
            statusText: 'Bad Request',
            headers: { 'content-type': 'application/json' },
          },
        ),
      )

      try {
        await getFetcher('https://sandbox-quickbooks.api.intuit.com/v3/x', {})
        throw new Error('expected throw')
      } catch (e) {
        const err = e as HttpFetchError
        expect(err.message).toBe('Required param missing — Name is required')
        // Status and URL are preserved on the error fields, not in the message.
        expect(err.status).toBe(400)
        expect(err.url).toBe('https://sandbox-quickbooks.api.intuit.com/v3/x')
      }
    })

    it('surfaces Copilot { message } into error.message', async () => {
      ;(fetch as any).mockResolvedValueOnce(
        new Response(JSON.stringify({ message: 'workspace not found' }), {
          status: 404,
          statusText: 'Not Found',
          headers: { 'content-type': 'application/json' },
        }),
      )

      try {
        await getFetcher('https://api.copilot.app/v1/workspaces/x', {})
        throw new Error('expected throw')
      } catch (e) {
        const err = e as HttpFetchError
        expect(err.message).toBe('workspace not found')
      }
    })

    it('falls back to generic HTTP message when body has no recognizable detail', async () => {
      ;(fetch as any).mockResolvedValueOnce(
        new Response(JSON.stringify({ unrelated: 'shape' }), {
          status: 502,
          statusText: 'Bad Gateway',
          headers: { 'content-type': 'application/json' },
        }),
      )

      try {
        await getFetcher('https://example.com/y', {})
        throw new Error('expected throw')
      } catch (e) {
        const err = e as HttpFetchError
        expect(err.message).toBe('HTTP 502 Bad Gateway')
        expect(err.url).toBe('https://example.com/y')
      }
    })

    it('falls back to raw text body when response is not JSON', async () => {
      ;(fetch as any).mockResolvedValueOnce(
        new Response('<html>oops</html>', {
          status: 504,
          statusText: 'Gateway Timeout',
          headers: { 'content-type': 'text/html' },
        }),
      )

      try {
        await getFetcher('https://example.com/y', {})
        throw new Error('expected throw')
      } catch (e) {
        const err = e as HttpFetchError
        expect(err.status).toBe(504)
        expect(err.body).toBe('<html>oops</html>')
      }
    })

    it('aborts the request when the per-call timeoutMs elapses', async () => {
      vi.useFakeTimers()
      try {
        // Real fetch honors the signal: reject when the signal aborts.
        // AbortSignal.timeout() produces a TimeoutError (Node 18+).
        ;(fetch as any).mockImplementationOnce(
          (_url: string, init: RequestInit) =>
            new Promise((_resolve, reject) => {
              const signal = init.signal as AbortSignal
              const onAbort = () => {
                const err = new Error('The operation was aborted')
                ;(err as any).name = 'TimeoutError'
                reject(err)
              }
              if (signal.aborted) onAbort()
              else signal.addEventListener('abort', onAbort, { once: true })
            }),
        )

        const pending = getFetcher(
          'https://example.com/x',
          {},
          { timeoutMs: 50 },
        )
        const settled = pending.catch((e) => e)

        await vi.advanceTimersByTimeAsync(60)
        const result = await settled
        expect(result).toBeInstanceOf(Error)
        expect((result as Error).name).toBe('TimeoutError')
      } finally {
        vi.useRealTimers()
      }
    })

    it('does not abort before the configured timeout elapses', async () => {
      vi.useFakeTimers()
      try {
        ;(fetch as any).mockImplementationOnce(
          (_url: string, _init: RequestInit) =>
            new Promise((resolve) =>
              setTimeout(() => resolve(okJson({ late: true })), 10),
            ),
        )

        const pending = getFetcher(
          'https://example.com/x',
          {},
          { timeoutMs: 1000 },
        )
        await vi.advanceTimersByTimeAsync(15)
        await expect(pending).resolves.toEqual({ late: true })
      } finally {
        vi.useRealTimers()
      }
    })
  })

  describe('postFetcher', () => {
    it('serializes body and returns parsed JSON on a 2xx response', async () => {
      ;(fetch as any).mockResolvedValueOnce(okJson({ ok: true }))

      const result = await postFetcher(
        'https://example.com/x',
        { 'content-type': 'application/json' },
        { foo: 'bar' },
      )

      expect(result).toEqual({ ok: true })
      const init = (fetch as any).mock.calls[0][1] as RequestInit
      expect(init.method).toBe('POST')
      expect(init.body).toBe(JSON.stringify({ foo: 'bar' }))
    })

    it('throws HttpFetchError on non-2xx', async () => {
      ;(fetch as any).mockResolvedValueOnce(
        new Response('{"err":"x"}', {
          status: 500,
          statusText: 'Server Error',
          headers: { 'content-type': 'application/json' },
        }),
      )

      await expect(
        postFetcher('https://example.com/x', {}, { a: 1 }),
      ).rejects.toBeInstanceOf(HttpFetchError)
    })
  })
})
