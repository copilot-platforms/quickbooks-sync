import { Token } from '@/type/common'
import { CopilotAPI } from '@/utils/copilotAPI'

export async function getTokenPayload(token: string): Promise<Token | null> {
  const copilotClient = new CopilotAPI(token)
  const payload = await copilotClient.getTokenPayload()
  return payload as Token
}
