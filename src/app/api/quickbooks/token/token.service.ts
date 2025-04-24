import { BaseService } from '@/app/api/core/services/base.service'
import { QBTokenSelectSchemaType } from '@/db/schema/qbTokens'
import { getPortalConnection } from '@/db/service/token.service'

export class TokenService extends BaseService {
  async checkPortalConnection(
    portalId: string,
  ): Promise<QBTokenSelectSchemaType | null> {
    const portalConnection = await getPortalConnection(portalId)

    return portalConnection
  }
}
