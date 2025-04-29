import { z } from 'zod'

export const QBAuthTokenResponseSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  expires_in: z.number(),
  x_refresh_token_expires_in: z.number(),
  realmId: z.string(),
  token_type: z.string(),
})

export type QBAuthTokenResponse = z.infer<typeof QBAuthTokenResponseSchema>
