import { copilotAPIKey } from '@/config'
import { TokenSchema } from '@/type/common'
import { assemblyApi } from '@assembly-js/node-sdk'

// Decodes a request token into its payload. Kept separate from AssemblyAPI
// (workspace-scoped) so the token-scoped SDK stays out of the wholesale-mocked
// client — the auth boundary is the only caller.
export async function getAssemblyTokenPayload(token: string) {
  const sdk = await assemblyApi({ apiKey: copilotAPIKey, token })
  if (!sdk.getTokenPayload) {
    console.error(
      `getAssemblyTokenPayload | Could not parse token payload for token ${token}`,
    )
    return null
  }
  return TokenSchema.parse(await sdk.getTokenPayload())
}
