import { UserRole } from '@/app/api/core/types/user'
import { Token } from '@/type/common'

/**
 * Faux model for Copilot Users (IU + Client)
 * This model is used to repressent the current user based on the token payload decrypted by Copilot SDK
 */
class User {
  token: string
  role: UserRole
  workspaceId: string
  clientId?: string
  companyId?: string
  internalUserId?: string

  // Instantiate a User from a request token & decrypted payload
  constructor(token: string, tokenPayload: Token) {
    this.token = token
    this.role = tokenPayload.internalUserId ? UserRole.IU : UserRole.CLIENT
    this.internalUserId = tokenPayload.internalUserId
    this.clientId = tokenPayload.clientId
    this.companyId = tokenPayload.companyId
    this.workspaceId = tokenPayload.workspaceId
  }
}

export default User
