import { testApiHandler } from 'next-test-api-route-handler'
import * as appHandler from '@/app/api/quickbooks/product/map/route'
import { TEST_WEBHOOK_TOKEN } from '@test/helpers/seed'

/** POSTs to /api/quickbooks/product/map and returns the Response. Never asserts. */
export async function postProductMap(
  body: unknown,
  opts: { token?: string } = {},
): Promise<Response> {
  const token = opts.token ?? TEST_WEBHOOK_TOKEN
  let response!: Response
  await testApiHandler({
    appHandler,
    url: `/api/quickbooks/product/map?token=${token}`,
    test: async ({ fetch }) => {
      response = await fetch({
        method: 'POST',
        body: JSON.stringify(body),
        headers: { 'content-type': 'application/json' },
      })
    },
  })
  return response
}
