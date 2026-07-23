import { BaseService } from '@/app/api/core/services/base.service'
import { QBAccountQueryResponseSchema } from '@/type/dto/intuitAPI.dto'
import IntuitAPI, { QB_ACCOUNT_COLUMNS } from '@/utils/intuitAPI'

export class BankAccountService extends BaseService {
  async listActiveBankAccounts(intuitApi: IntuitAPI) {
    // 1000 is QBO's max single-page size — far more bank accounts than any
    // real company has, so a single query returns them all.
    const rawResult = await intuitApi.customQuery(
      `SELECT ${QB_ACCOUNT_COLUMNS.join(', ')} FROM Account WHERE AccountType = 'Bank' AND Active = true maxresults 1000`,
    )
    return QBAccountQueryResponseSchema.parse(rawResult ?? {}).Account ?? []
  }
}
