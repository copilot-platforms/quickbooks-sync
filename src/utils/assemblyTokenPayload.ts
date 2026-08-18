import { copilotAPIKey } from '@/config'
import { TokenSchema } from '@/type/common'
import { assemblyApi } from '@assembly-js/node-sdk'

// Decodes a request token into its payload. Kept separate from AssemblyAPI
// (which is workspace-scoped) so the token-scoped SDK stays out of the
// wholesale-mocked client — the auth boundary is the only caller.
export class AssemblyTokenPayload {
  async getTokenPayload(token: string) {
    const sdk = await assemblyApi({ apiKey: copilotAPIKey, token })
    const getTokenPayload = sdk.getTokenPayload
    if (!getTokenPayload) {
      console.error(
        `AssemblyTokenPayload#getTokenPayload | Could not parse token payload for token ${token}`,
      )
      return null
    }

    return TokenSchema.parse(await getTokenPayload())
  }
}
