import { Token } from '@/type/common'
import { AssemblyTokenPayload } from '@/utils/assemblyTokenPayload'

export async function getTokenPayload(token: string): Promise<Token | null> {
  return await new AssemblyTokenPayload().getTokenPayload(token)
}
