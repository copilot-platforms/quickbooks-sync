import { BaseService } from '@/app/api/core/services/base.service'
import { QBAccountQueryResponseSchema } from '@/type/dto/intuitAPI.dto'
import IntuitAPI, { QB_ACCOUNT_COLUMNS } from '@/utils/intuitAPI'

export class BankAccountService extends BaseService {
  async listActiveBankAccounts(intuitApi: IntuitAPI) {
    const rawResult = await intuitApi.customQuery(
      `SELECT ${QB_ACCOUNT_COLUMNS.join(', ')} FROM Account WHERE AccountType = 'Bank' AND Active = true maxresults 100`,
    )
    return QBAccountQueryResponseSchema.parse(rawResult ?? {}).Account ?? []
  }
}
