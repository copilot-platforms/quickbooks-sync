import { Token } from '@/type/common'
import { getAssemblyTokenPayload } from '@/utils/assemblyTokenPayload'

export async function getTokenPayload(token: string): Promise<Token | null> {
  return await getAssemblyTokenPayload(token)
}
