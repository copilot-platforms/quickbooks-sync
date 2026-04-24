import { testApiHandler } from 'next-test-api-route-handler'
import * as appHandler from '@/app/api/quickbooks/webhook/route'
import { TEST_WEBHOOK_TOKEN } from '@test/helpers/seed'

/**
 * Posts a JSON payload to the QuickBooks webhook route through
 * `next-test-api-route-handler` and returns the Response. The caller is
 * responsible for asserting on status / body — this helper never asserts.
 */
export async function postWebhook(
  payload: unknown,
  opts: { token?: string } = {},
): Promise<Response> {
  const token = opts.token ?? TEST_WEBHOOK_TOKEN
  let response!: Response
  await testApiHandler({
    appHandler,
    url: `/api/quickbooks/webhook?token=${token}`,
    test: async ({ fetch }) => {
      response = await fetch({
        method: 'POST',
        body: JSON.stringify(payload),
        headers: { 'content-type': 'application/json' },
      })
    },
  })
  return response
}
