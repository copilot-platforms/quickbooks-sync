import { BaseService } from '@/app/api/core/services/base.service'
import { getPortalTokens } from '@/db/service/token.service'
import APIError from '@/app/api/core/exceptions/api'
import httpStatus from 'http-status'
import IntuitAPI from '@/utils/intuitAPI'
import { AccountsListResponse } from '@/type/common'

export class AccountService extends BaseService {
  async listAccountsForProductMapping(): Promise<AccountsListResponse> {
    let tokens
    try {
      tokens = await getPortalTokens(this.user.workspaceId)
    } catch {
      throw new APIError(
        httpStatus.NOT_FOUND,
        'AccountService#listAccountsForProductMapping | no portal connection',
      )
    }

    const intuitApi = new IntuitAPI(tokens)
    const { income, expense, asset } =
      await intuitApi.getAccountsForProductMapping()

    return {
      options: {
        income: income.map((a) => ({ id: a.Id, name: a.Name })),
        expense: expense.map((a) => ({ id: a.Id, name: a.Name })),
        asset: asset.map((a) => ({ id: a.Id, name: a.Name })),
      },
      selected: {
        incomeAccountRef: tokens.incomeAccountRef,
        expenseAccountRef: tokens.expenseAccountRef,
        assetAccountRef: tokens.assetAccountRef,
      },
    }
  }
}
