/**
 * Unit tests for `IntuitAPI._getCustomerByEmail` — the QBO customer lookup
 * that paginates through all customers and matches by email client-side.
 *
 * Why this exists at all: QBO's `/query` parser silently mishandles certain
 * special chars (confirmed for '+', and both `=` and `LIKE` literals fail) on
 * `WHERE PrimaryEmailAddr = '...'`, returning 0 results even when a matching
 * customer exists. To stay correct for any RFC-legal email, we never put the
 * email in the WHERE clause — we walk the realm and filter in JS.
 *
 * Coverage focus:
 *   - Pagination terminates correctly on empty pages, partial pages, full
 *     pages followed by empty (off-by-one guard), and on first match.
 *   - Match is case-insensitive and whitespace-tolerant on both sides
 *     (search input AND stored value).
 *   - Rows missing `PrimaryEmailAddr` do not throw — the predicate
 *     short-circuits on the optional key.
 *   - Empty/whitespace email short-circuits without calling QBO.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@sentry/nextjs', () => ({
  withScope: vi.fn(),
  captureMessage: vi.fn(),
  captureException: vi.fn(),
}))

vi.mock('@/utils/logger', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
  },
}))

// `_getCustomerByEmail` only uses `customQuery` from the instance; stubbing
// fetch helpers is defensive so any accidental fall-through fails loudly
// instead of hitting the network.
vi.mock('@/helper/fetch.helper', () => ({
  getFetcher: vi.fn(),
  postFetcher: vi.fn(),
}))

import IntuitAPI, { IntuitAPITokensType } from '@/utils/intuitAPI'

const baseTokens: IntuitAPITokensType = {
  accessToken: 'access',
  refreshToken: 'refresh',
  intuitRealmId: 'realm-1',
  incomeAccountRef: 'income',
  expenseAccountRef: 'expense',
  assetAccountRef: 'asset',
  serviceItemRef: 'service',
  clientFeeRef: 'client-fee',
}

// Builds a customer row in the shape QBO returns inside `QueryResponse.Customer`.
// `email: null` produces a row with no `PrimaryEmailAddr` at all — covers the
// "Address absent" branch.
function row(
  id: string,
  email: string | null,
  overrides: Record<string, unknown> = {},
) {
  const base = {
    Id: id,
    SyncToken: '0',
    Active: true,
    CompanyName: undefined,
    ...overrides,
  }
  if (email === null) return base
  return { ...base, PrimaryEmailAddr: { Address: email } }
}

// `customQuery` is a public field on IntuitAPI (`this.wrapWithRetry(this._customQuery)`).
// We replace it on the instance after construction so the test controls what
// each page returns. `getCustomerByEmail` is bound at construction time to the
// instance, so mutations to `instance.customQuery` are visible to it.
function makeApi(pages: Array<unknown>) {
  const api = new IntuitAPI(baseTokens)
  const customQuery = vi.fn()
  for (const page of pages) {
    customQuery.mockResolvedValueOnce(page)
  }
  // Any call beyond the configured pages should make the test fail loudly
  // instead of silently looping or returning undefined.
  customQuery.mockImplementation(() => {
    throw new Error('customQuery called more times than test configured')
  })
  ;(api as unknown as { customQuery: unknown }).customQuery = customQuery
  return { api, customQuery }
}

describe('IntuitAPI#getCustomerByEmail', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns undefined without calling QBO when email is empty', async () => {
    // Guard against a degenerate input wasting a full-realm walk. The early
    // return short-circuits before any QBO request.
    const { api, customQuery } = makeApi([])

    const result = await api.getCustomerByEmail('', undefined)

    expect(result).toBeUndefined()
    expect(customQuery).not.toHaveBeenCalled()
  })

  it('returns undefined without calling QBO when email is whitespace only', async () => {
    // Same guard as above; trim happens before the empty check.
    const { api, customQuery } = makeApi([])

    const result = await api.getCustomerByEmail('   \t\n  ', undefined)

    expect(result).toBeUndefined()
    expect(customQuery).not.toHaveBeenCalled()
  })

  it('returns undefined when QBO returns an empty Customer array', async () => {
    // `Customer` array present but empty → realm has no customers → terminate.
    const { api, customQuery } = makeApi([{ Customer: [] }])

    const result = await api.getCustomerByEmail('alice@example.com', undefined)

    expect(result).toBeUndefined()
    expect(customQuery).toHaveBeenCalledTimes(1)
  })

  it('returns undefined when QBO returns no Customer field at all', async () => {
    // QBO omits `Customer` entirely when the result is empty for some queries.
    // The `?? []` coalesce treats this identically to an empty array.
    const { api, customQuery } = makeApi([{}])

    const result = await api.getCustomerByEmail('alice@example.com', undefined)

    expect(result).toBeUndefined()
    expect(customQuery).toHaveBeenCalledTimes(1)
  })

  it('finds an exact-match customer on the first page', async () => {
    // Happy path: realm returns a partial page (< pageSize), we find the match.
    const { api, customQuery } = makeApi([
      {
        Customer: [
          row('1', 'bob@example.com'),
          row('2', 'alice@example.com'),
          row('3', 'carol@example.com'),
        ],
      },
    ])

    const result = await api.getCustomerByEmail('alice@example.com', undefined)

    expect(result?.Id).toBe('2')
    // Partial-page short-circuit: only one query, no second-page probe.
    expect(customQuery).toHaveBeenCalledTimes(1)
  })

  it('matches case-insensitively (search uppercase, stored lowercase)', async () => {
    // QBO is documented as case-insensitive on email — our client-side compare
    // must respect that contract or we regress on emails like 'User@X.com'.
    const { api } = makeApi([{ Customer: [row('1', 'alice@example.com')] }])

    const result = await api.getCustomerByEmail('ALICE@EXAMPLE.COM', undefined)

    expect(result?.Id).toBe('1')
  })

  it('matches case-insensitively (stored uppercase, search lowercase)', async () => {
    // Symmetric of the above; both sides are normalised before compare.
    const { api } = makeApi([{ Customer: [row('1', 'Alice+Tag@Example.COM')] }])

    const result = await api.getCustomerByEmail(
      'alice+tag@example.com',
      undefined,
    )

    expect(result?.Id).toBe('1')
  })

  it('trims whitespace on both the input email and the stored Address', async () => {
    // Both sides are trimmed before compare, so accidental whitespace from
    // either Copilot payload or QBO storage does not cause a false negative.
    const { api } = makeApi([{ Customer: [row('1', '  alice@example.com  ')] }])

    const result = await api.getCustomerByEmail(
      '\nalice@example.com\t',
      undefined,
    )

    expect(result?.Id).toBe('1')
  })

  it('finds the match on page 2 (advances STARTPOSITION correctly)', async () => {
    // Pagination correctness: first 1000-row page has no match, second page
    // contains the target. Verifies the loop advances by pageSize and does
    // not re-scan page 1.
    const page1 = {
      Customer: Array.from({ length: 1000 }, (_, i) =>
        row(`p1-${i}`, `noise${i}@example.com`),
      ),
    }
    const page2 = {
      Customer: [row('target', 'alice+tag@example.com')],
    }
    const { api, customQuery } = makeApi([page1, page2])

    const result = await api.getCustomerByEmail(
      'alice+tag@example.com',
      undefined,
    )

    expect(result?.Id).toBe('target')
    expect(customQuery).toHaveBeenCalledTimes(2)
    // Sanity: the queries differ by STARTPOSITION (1 then 1001).
    const firstQuery = customQuery.mock.calls[0][0] as string
    const secondQuery = customQuery.mock.calls[1][0] as string
    expect(firstQuery).toContain('STARTPOSITION 1 ')
    expect(secondQuery).toContain('STARTPOSITION 1001 ')
  })

  it('terminates after a full page followed by an empty page (off-by-one guard)', async () => {
    // Edge case the reviewer specifically asked to verify: if the LAST real
    // page happens to contain exactly pageSize rows, the next iteration must
    // see an empty page and terminate. Without this, the loop runs forever
    // (or until QBO errors out).
    const fullPage = {
      Customer: Array.from({ length: 1000 }, (_, i) =>
        row(`p1-${i}`, `noise${i}@example.com`),
      ),
    }
    const emptyPage = { Customer: [] }
    const { api, customQuery } = makeApi([fullPage, emptyPage])

    const result = await api.getCustomerByEmail('alice@example.com', undefined)

    expect(result).toBeUndefined()
    expect(customQuery).toHaveBeenCalledTimes(2)
  })

  it('terminates on a partial page even when no match is found', async () => {
    // < pageSize rows means QBO has no more pages. We must NOT issue a
    // speculative next-page query that would just come back empty.
    const { api, customQuery } = makeApi([
      {
        Customer: [row('1', 'bob@example.com'), row('2', 'carol@example.com')],
      },
    ])

    const result = await api.getCustomerByEmail('alice@example.com', undefined)

    expect(result).toBeUndefined()
    expect(customQuery).toHaveBeenCalledTimes(1)
  })

  it('skips rows with missing PrimaryEmailAddr without throwing', async () => {
    // A row with no email field must not crash the predicate.
    const { api } = makeApi([
      {
        Customer: [
          row('1', null),
          row('2', null),
          row('3', 'alice@example.com'),
        ],
      },
    ])

    const result = await api.getCustomerByEmail('alice@example.com', undefined)

    expect(result?.Id).toBe('3')
  })

  it('skips rows with null PrimaryEmailAddr or null Address without ZodError-ing the page', async () => {
    // Regression guard: a single malformed row must not taint the whole-
    // page parse. Schema permits PrimaryEmailAddr and Address to be null;
    // the typeof addr === 'string' predicate skips them.
    const { api } = makeApi([
      {
        Customer: [
          row('1', null, { PrimaryEmailAddr: null }),
          row('2', null, { PrimaryEmailAddr: { Address: null } }),
          row('3', 'alice@example.com'),
        ],
      },
    ])

    const result = await api.getCustomerByEmail('alice@example.com', undefined)

    expect(result?.Id).toBe('3')
  })

  it('returns the first match when multiple customers share the same email and pass the company predicate', async () => {
    // QBO does not enforce email uniqueness across customers. With
    // `sanitizedCompanyName=undefined` and rows that both have no
    // CompanyName, both pass the company check, so `find` returns the
    // first one in document order. Documenting this guards against a
    // regression that re-orders results or returns all matches.
    const { api } = makeApi([
      {
        Customer: [
          row('first', 'alice@example.com'),
          row('second', 'alice@example.com'),
        ],
      },
    ])

    const result = await api.getCustomerByEmail('alice@example.com', undefined)

    expect(result?.Id).toBe('first')
  })

  it('finds a customer whose email contains a "+" alias (the original bug)', async () => {
    // The motivating scenario for this whole rewrite. With the old
    // `WHERE PrimaryEmailAddr = '...'` query, QBO silently returned 0 rows
    // for plus-aliased addresses. The walk-and-filter approach never puts
    // the email in the query, so '+' is irrelevant.
    const { api } = makeApi([
      {
        Customer: [
          row('1', 'bob@example.com'),
          row('2', 'json+smith@gmail.com'),
        ],
      },
    ])

    const result = await api.getCustomerByEmail(
      'json+smith@gmail.com',
      undefined,
    )

    expect(result?.Id).toBe('2')
  })

  it('emits a query that includes inactive customers', async () => {
    // Drift recovery must consider deactivated customers — a customer might
    // have been soft-deleted in QBO and the email lookup is the path that
    // surfaces them so callers can decide whether to reactivate or duplicate.
    const { api, customQuery } = makeApi([
      { Customer: [row('1', 'alice@example.com', { Active: false })] },
    ])

    const result = await api.getCustomerByEmail('alice@example.com', undefined)

    expect(result?.Id).toBe('1')
    const query = customQuery.mock.calls[0][0] as string
    expect(query).toMatch(/Active IN \(true, false\)/)
  })

  it('emits ORDERBY Id ASC so the cursor is stable across pages', async () => {
    // Without an explicit order, QBO sorts by MetaData.LastUpdatedTime DESC.
    // A customer updated between page fetches shifts under that ordering and
    // can be skipped near a STARTPOSITION boundary. Id is monotonic and
    // immutable, so concurrent updates do not move rows and concurrent
    // creates always land at the end of the cursor.
    const { api, customQuery } = makeApi([
      { Customer: [row('1', 'alice@example.com')] },
    ])

    await api.getCustomerByEmail('alice@example.com', undefined)

    const query = customQuery.mock.calls[0][0] as string
    expect(query).toMatch(/ORDERBY Id ASC/)
  })

  // Company-aware matching: a Copilot client can be enrolled in multiple
  // companies, so the same email may exist on multiple QBO customers — only
  // the one whose CompanyName matches the recipient's company is the right
  // one to update. Without this filter the walker would return the first
  // email-match and the post-filter in customer.service.ts would null it
  // out, producing a duplicate-create regression.

  it('returns the customer whose CompanyName matches the sanitised company name', async () => {
    // Two customers share the same email; only the one with CompanyName
    // "Acme" should be returned when we search for that company.
    const { api } = makeApi([
      {
        Customer: [
          row('beta', 'alice@example.com', { CompanyName: 'Beta Inc' }),
          row('acme', 'alice@example.com', { CompanyName: 'Acme' }),
          row('gamma', 'alice@example.com', { CompanyName: 'Gamma' }),
        ],
      },
    ])

    const result = await api.getCustomerByEmail('alice@example.com', 'Acme')

    expect(result?.Id).toBe('acme')
  })

  it('skips email-matching customers with the wrong CompanyName and walks on to the next page', async () => {
    // The motivating scenario: page 1 has an email-match with the wrong
    // company, page 2 has the correct one. Walker must skip and continue,
    // not stop at the first email match.
    const page1 = {
      Customer: [
        row('wrong', 'alice@example.com', { CompanyName: 'Beta Inc' }),
        ...Array.from({ length: 999 }, (_, i) =>
          row(`p1-${i}`, `noise${i}@example.com`),
        ),
      ],
    }
    const page2 = {
      Customer: [row('right', 'alice@example.com', { CompanyName: 'Acme' })],
    }
    const { api, customQuery } = makeApi([page1, page2])

    const result = await api.getCustomerByEmail('alice@example.com', 'Acme')

    expect(result?.Id).toBe('right')
    expect(customQuery).toHaveBeenCalledTimes(2)
  })

  it('rejects customers with a CompanyName when searching for an individual (no company)', async () => {
    // Searching with `sanitizedCompanyName === undefined` means "individual
    // customer, no company affiliation". A customer whose CompanyName is
    // set must NOT match — picking them would mis-attribute an individual
    // invoice to a company customer. Mirrors the post-filter semantics in
    // customer.service.ts.
    const { api } = makeApi([
      {
        Customer: [
          row('company-attached', 'alice@example.com', {
            CompanyName: 'Acme',
          }),
          row('individual', 'alice@example.com'),
        ],
      },
    ])

    const result = await api.getCustomerByEmail('alice@example.com', undefined)

    expect(result?.Id).toBe('individual')
  })

  it('treats empty-string CompanyName as equivalent to undefined when searching for an individual', async () => {
    // QBO sometimes returns CompanyName as "" instead of omitting the field.
    // The `(c.CompanyName || undefined)` normalisation must coalesce empty
    // string with undefined so the customer is still considered an
    // individual. Without this, accidentally-blank QBO records would always
    // miss and trigger a duplicate-create.
    const { api } = makeApi([
      {
        Customer: [row('1', 'alice@example.com', { CompanyName: '' })],
      },
    ])

    const result = await api.getCustomerByEmail('alice@example.com', undefined)

    expect(result?.Id).toBe('1')
  })

  it('returns undefined when no customer matches both the email and the company', async () => {
    // Email exists in QBO but for a different company. The right behaviour
    // is to return undefined so callers create a new customer for this
    // (email, company) pair — not return the wrong-company match.
    const { api } = makeApi([
      {
        Customer: [
          row('beta', 'alice@example.com', { CompanyName: 'Beta Inc' }),
        ],
      },
    ])

    const result = await api.getCustomerByEmail('alice@example.com', 'Acme')

    expect(result).toBeUndefined()
  })
})
