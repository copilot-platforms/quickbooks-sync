import { externalFetchTimeoutMs } from '@/config'
import { HttpFetchError } from '@/utils/error'

export type FetcherOptions = {
  // number = use this timeout; null = disable timeout entirely (no AbortSignal
  // attached); undefined = fall back to externalFetchTimeoutMs.
  timeoutMs?: number | null
}

// Pulls a human-readable detail out of common upstream error shapes so the
// thrown HttpFetchError surfaces *why* the call failed in `error.message`
// (which is what gets written to qb_sync_logs). Without this, the message
// degrades to a generic "HTTP 400 Bad Request from <url>" and the real
// reason — e.g. Intuit's "Required param missing" — only lives in
// `error.body`, which most downstream consumers don't inspect.
const extractUpstreamDetail = (body: unknown): string | undefined => {
  if (!body || typeof body !== 'object') return undefined
  const b = body as Record<string, any>

  // Intuit (QBO):
  //   { Fault: { Error: [{ Message, Detail, code }], type: '...' } }
  // Detail is usually the diagnostic; Message is a short label.
  const intuitErr = b?.Fault?.Error?.[0]
  if (intuitErr && typeof intuitErr === 'object') {
    const parts = [intuitErr.Message, intuitErr.Detail]
      .filter((p) => typeof p === 'string' && p.length > 0)
      .join(' — ')
    if (parts) return parts
  }

  // Copilot and many other JSON APIs:  { message: '...' }  or  { error: '...' }
  if (typeof b.message === 'string' && b.message) return b.message
  if (typeof b.error === 'string' && b.error) return b.error

  return undefined
}

// Exported so other clients with their own fetch wrappers (e.g. CopilotAPI's
// manualFetch) can produce consistently-shaped HttpFetchError instances
// without duplicating the JSON/text body-parsing logic.
export const buildHttpFetchError = async (
  response: Response,
  url: string,
): Promise<HttpFetchError> => {
  const rawBody = await response.text().catch(() => '')
  let body: unknown = rawBody
  if (rawBody) {
    try {
      body = JSON.parse(rawBody)
    } catch {
      // not JSON; keep raw text
    }
  }

  // Prefer the upstream detail as the message when present — it's what
  // qb_sync_logs.message and any user-facing surface actually want to show.
  // The HTTP status lives on error.status / qb_sync_logs.code and the URL
  // lives on error.url, so we don't lose them by omitting them here.
  const detail = extractUpstreamDetail(body)
  const message =
    detail ?? `HTTP ${response.status} ${response.statusText || ''}`.trim()

  return new HttpFetchError({
    status: response.status,
    statusText: response.statusText,
    url,
    body,
    message,
  })
}

const resolveSignal = (opts: FetcherOptions): AbortSignal | undefined => {
  if (opts.timeoutMs === null) return undefined
  return AbortSignal.timeout(opts.timeoutMs ?? externalFetchTimeoutMs)
}

export const postFetcher = async (
  url: string,
  headers: Record<string, string>,
  body: Record<string, any>,
  opts: FetcherOptions = {},
) => {
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: resolveSignal(opts),
  })

  if (!response.ok) throw await buildHttpFetchError(response, url)
  return response.json()
}

export const getFetcher = async (
  url: string,
  headers: Record<string, string>,
  opts: FetcherOptions = {},
) => {
  const response = await fetch(url, {
    headers,
    signal: resolveSignal(opts),
  })

  if (!response.ok) throw await buildHttpFetchError(response, url)
  return response.json()
}
